import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { isBotEnabled } from '@/lib/aiKillSwitch'
import { avitoSendMessage, isAvitoConfigured } from '@/lib/avito'
import { notifyAdmins } from '@/lib/telegram'

export const maxDuration = 120

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
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const svc = createServiceClient()
  if (!(await isBotEnabled(svc))) return NextResponse.json({ ok: true, bot_disabled: true })

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

  if (stat.sent > 0) {
    await notifyAdmins(`🔁 Иван напомнил о себе ${stat.sent} клиентам (Авито)`).catch(() => {})
  }
  return NextResponse.json({ ok: true, ...stat })
}
