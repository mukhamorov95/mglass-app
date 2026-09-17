import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { isBotEnabled } from '@/lib/aiKillSwitch'
import { avitoSendMessage, isAvitoConfigured } from '@/lib/avito'
import { notifyAdmins } from '@/lib/telegram'
import { CRM_ZONES } from '@/lib/crmStages'
import { AI_MANAGERS, botGate } from '@/lib/avito/botGate'
import { muteIfHumanInThread } from '@/lib/avito/humanInThread'

export const maxDuration = 120

const QUALIFICATION_STAGES = new Set(CRM_ZONES.find(z => z.zone === 'Квалификация')?.stages ?? [])

// Ф2: Иван возвращается к замолчавшим клиентам. Правило владельца: клиентам
// пишет ТОЛЬКО Иван — этот крон часть его контура, не отдельный бот.
// Пишем один раз через сутки молчания и один раз через трое. Дальше — тишина:
// навязчивость на Авито хуже, чем потерянный лид.

const DAY = 86_400_000

// Коротко и без обещания цены: цену бот не называет, считает менеджер.
const FIRST = 'Здравствуйте! Задача ещё актуальна? Подскажите размеры — передам менеджеру на расчёт.'
const SECOND = 'Добрый день! Напомню о себе: если душевая или зеркало ещё нужны — напишите, поможем.'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const svc = createServiceClient()
  if (!(await isBotEnabled(svc))) return NextResponse.json({ ok: true, bot_disabled: true })

  const nowIso = new Date().toISOString()
  const processed = new Set<number>()   // лиды, которым уже написали в этот прогон
  const taskStat = { fired: 0, skipped: 0 }

  // Фаза B: «созревшие» задачи-себе — бот возвращается к отложенному клиенту по
  // назначенной дате с контекстом (в отличие от общего 1/3-дневного напоминания ниже).
  const { data: dueTasks } = await svc.from('crm_tasks')
    .select('id, lead_id, title, due_at')
    .eq('kind', 'followup').eq('done', false).in('assignee', AI_MANAGERS)
    .lte('due_at', nowIso).order('due_at').limit(40)

  for (const t of (dueTasks ?? []) as { id: number; lead_id: number; title: string; due_at: string }[]) {
    const { data: ld } = await svc.from('crm_leads')
      .select('id, manager, bot_muted, bot_muted_by, status, stage, avito_chat_id, avito_user_id').eq('id', t.lead_id).maybeSingle()
    const lead = ld as { id: number; manager: string | null; bot_muted: boolean | null; bot_muted_by: string | null; status: string | null; stage: string | null; avito_chat_id: string | null; avito_user_id: number | null } | null
    // Бот пишет, только если лид всё ещё за ботом, в зоне «Квалификация», активен и настроен.
    if (!lead || !lead.avito_chat_id || lead.avito_user_id == null) { taskStat.skipped++; continue }
    if (!botGate(lead, QUALIFICATION_STAGES).allowed) { taskStat.skipped++; continue }
    if (!isAvitoConfigured()) { taskStat.skipped++; continue }
    if (await muteIfHumanInThread(svc, lead, lead.avito_user_id, lead.avito_chat_id)) { taskStat.skipped++; continue }

    const note = t.title.replace(/^Вернуться:\s*/i, '').trim()
    const text = note && !/отложенному клиенту/i.test(note)
      ? `Здравствуйте! Вы говорили — ${note}. Подскажите, как продвигается? Если готовы, согласуем замер.`
      : 'Здравствуйте! Напомню о себе — если задача ещё актуальна, подскажите, и двинемся к замеру.'
    try {
      await avitoSendMessage(lead.avito_user_id, lead.avito_chat_id, text)
      await svc.from('crm_lead_events').insert({ lead_id: lead.id, kind: 'message', text: `БОТ: ${text}`, author: 'AI' })
      await svc.from('crm_tasks').update({ done: true, done_at: nowIso }).eq('id', t.id)
      await svc.from('crm_leads').update({ updated_at: nowIso }).eq('id', lead.id)
      processed.add(lead.id)
      taskStat.fired++
    } catch { taskStat.skipped++ }
  }

  const { data: leads } = await svc.from('crm_leads')
    .select('id, name, manager, bot_muted, bot_muted_by, stage, status, avito_chat_id, avito_user_id, followup_count, updated_at')
    .not('avito_chat_id', 'is', null)
    .not('status', 'in', '("won","lost")')
    .eq('bot_muted', false)
    // Новый лид из вебхука создаётся без этапа — он тоже в квалификации.
    .or(`stage.is.null,stage.in.(${[...QUALIFICATION_STAGES].map(x => `"${x}"`).join(',')})`)
    .or('followup_count.is.null,followup_count.lt.2')
    // Окно 30 дней и фильтры в запросе, а не в цикле: раньше брались 40 самых старых
    // лидов с июля, отсеивались в коде и никогда не обновлялись — до свежих очередь
    // не доходила, за месяц не ушло ни одного напоминания при 88 подходящих.
    .gte('updated_at', new Date(Date.now() - 30 * DAY).toISOString())
    .lt('updated_at', new Date(Date.now() - DAY).toISOString())
    .order('updated_at', { ascending: false })
    .limit(60)

  const rows = (leads ?? []) as {
    id: number; name: string | null; manager: string | null; bot_muted: boolean | null; bot_muted_by: string | null
    stage: string | null; status: string | null
    avito_chat_id: string; avito_user_id: number | null; followup_count: number | null; updated_at: string
  }[]

  const stat = { checked: rows.length, sent: 0, skipped: 0, errors: [] as string[] }

  for (const lead of rows) {
    if (processed.has(lead.id)) { stat.skipped++; continue }   // уже написали по задаче-себе
    // Тот же замок, что в вебхуке. Раньше здесь не проверялся этап: лид, уехавший
    // в «Замер проведён» с manager = null, всё равно получал напоминание Ивана.
    if (!botGate(lead, QUALIFICATION_STAGES).allowed) { stat.skipped++; continue }
    const sentCount = lead.followup_count ?? 0
    if (sentCount >= 2) { stat.skipped++; continue }

    // Последнее сообщение должно быть нашим: если клиент ответил, а мы нет —
    // это не «молчащий клиент», а недоработанный диалог, туда лезть нельзя.
    const { data: last } = await svc.from('crm_lead_events')
      .select('text, created_at').eq('lead_id', lead.id).eq('kind', 'message')
      .order('id', { ascending: false }).limit(1).maybeSingle()
    const lastEv = last as { text: string; created_at: string } | null
    if (!lastEv || !lastEv.text.startsWith('БОТ: ')) { stat.skipped++; continue }

    const silentFor = Date.now() - Date.parse(lastEv.created_at)
    const needed = sentCount === 0 ? DAY : 3 * DAY
    if (silentFor < needed) { stat.skipped++; continue }

    // Нечем отправить — молчим. Записать «БОТ: …» в ленту, не доставив
    // сообщение клиенту, хуже чем не написать: лента станет врать менеджеру.
    if (!isAvitoConfigured() || lead.avito_user_id == null) { stat.skipped++; continue }
    if (await muteIfHumanInThread(svc, lead, lead.avito_user_id, lead.avito_chat_id)) { stat.skipped++; continue }

    const text = sentCount === 0 ? FIRST : SECOND
    try {
      await avitoSendMessage(lead.avito_user_id, lead.avito_chat_id, text)
      await svc.from('crm_lead_events').insert({
        lead_id: lead.id, kind: 'message', text: `БОТ: ${text}`, author: 'AI',
      })
      await svc.from('crm_leads').update({
        followup_count: sentCount + 1, updated_at: new Date().toISOString(),
      }).eq('id', lead.id)
      stat.sent++
    } catch (e) {
      if (stat.errors.length < 10) stat.errors.push(`#${lead.id}: ${e instanceof Error ? e.message : 'ошибка'}`)
    }
  }

  const totalSent = stat.sent + taskStat.fired
  if (totalSent > 0) {
    await notifyAdmins(`🔁 Иван напомнил о себе ${totalSent} клиентам (Авито): ${taskStat.fired} по задачам-себе, ${stat.sent} общих`).catch(() => {})
  }
  return NextResponse.json({ ok: true, ...stat, tasks: taskStat })
}
