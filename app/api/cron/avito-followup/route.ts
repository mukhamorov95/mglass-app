import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { isBotEnabled } from '@/lib/aiKillSwitch'
import { avitoSendMessage, isAvitoConfigured } from '@/lib/avito'
import { notifyAdmins } from '@/lib/telegram'
import { CRM_ZONES } from '@/lib/crmStages'

export const maxDuration = 120

const QUALIFICATION_STAGES = new Set(CRM_ZONES.find(z => z.zone === 'Квалификация')?.stages ?? [])

// Ф2: Иван возвращается к замолчавшим клиентам. Правило владельца: клиентам
// пишет ТОЛЬКО Иван — этот крон часть его контура, не отдельный бот.
// Пишем один раз через сутки молчания и один раз через трое. Дальше — тишина:
// навязчивость на Авито хуже, чем потерянный лид.

const AI_MANAGERS = ['Иван (AI)', 'AI-менеджер']
const DAY = 86_400_000

const FIRST = 'Здравствуйте! Я на связи — если ещё актуально, подскажите размеры, и я посчитаю точную стоимость.'
const SECOND = 'Добрый день! Не хочу быть навязчивым — просто напомню о себе. Если задача ещё в силе, напишите, посчитаю и подскажу по срокам.'

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
      .select('id, manager, status, stage, avito_chat_id, avito_user_id').eq('id', t.lead_id).maybeSingle()
    const lead = ld as { id: number; manager: string | null; status: string | null; stage: string | null; avito_chat_id: string | null; avito_user_id: number | null } | null
    // Бот пишет, только если лид всё ещё за ботом, в зоне «Квалификация», активен и настроен.
    if (!lead || !lead.avito_chat_id || lead.avito_user_id == null) { taskStat.skipped++; continue }
    if (lead.manager && !AI_MANAGERS.includes(lead.manager)) { taskStat.skipped++; continue }
    if (lead.status === 'won' || lead.status === 'lost') { taskStat.skipped++; continue }
    if (lead.stage && !QUALIFICATION_STAGES.has(lead.stage)) { taskStat.skipped++; continue }
    if (!isAvitoConfigured()) { taskStat.skipped++; continue }

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
    .select('id, name, manager, status, avito_chat_id, avito_user_id, followup_count, updated_at')
    .not('avito_chat_id', 'is', null)
    .not('status', 'in', '("won","lost")')
    .lt('updated_at', new Date(Date.now() - DAY).toISOString())
    .order('updated_at')
    .limit(40)

  const rows = (leads ?? []) as {
    id: number; name: string | null; manager: string | null; status: string | null
    avito_chat_id: string; avito_user_id: number | null; followup_count: number | null; updated_at: string
  }[]

  const stat = { checked: rows.length, sent: 0, skipped: 0, errors: [] as string[] }

  for (const lead of rows) {
    if (processed.has(lead.id)) { stat.skipped++; continue }   // уже написали по задаче-себе
    // Чат забрал человек — Иван молчит.
    if (lead.manager && !AI_MANAGERS.includes(lead.manager)) { stat.skipped++; continue }
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
