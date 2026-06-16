// Sales monitor — collects AmoCRM data and generates ROP-level insights.
// READ-ONLY: never writes to CRM cards.

import {
  getUsers, getPipelines, getLeads, getEvents, getLeadNotes,
  type AmoUser, type AmoEvent, type AmoNote, type AmoLead,
} from '@/lib/amocrm'

// ── Moscow timezone helper ─────────────────────────────────────────────────────
// Vercel servers run UTC. todayStart must be 00:00:00 Europe/Moscow, not UTC.
// Strategy: convert `now` to Moscow wall-clock components via toLocaleString,
// then build a Date.UTC timestamp for that calendar date and subtract +3h offset.
// Example: 02:30 MSK June 16 → moscowDate = June 16 → result = June 15 21:00 UTC
//                                                                = June 16 00:00 MSK ✓
function getMoscowDayStartUnix(now = new Date()): number {
  const moscowDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }))
  return Math.floor(
    Date.UTC(moscowDate.getFullYear(), moscowDate.getMonth(), moscowDate.getDate()) / 1000,
  ) - 3 * 3600
}

// ── note_type normalizer ───────────────────────────────────────────────────────
// AmoCRM API may return note_type as a string ("call_out") or a legacy number (4).
// Strict === would silently fail for numeric values. Always compare via String().
function noteTypeIs(
  noteType: string | number | undefined | null,
  ...expected: Array<string | number>
): boolean {
  return expected.some(e => String(noteType) === String(e))
}

// ── Wazzup note attribution ────────────────────────────────────────────────────
// Wazzup integration pushes notes into AmoCRM under its own service-account user,
// not under the responsible manager. If AMO_WAZZUP_BOT_USER_ID is set, those notes
// are attributed to whoever owns the lead — matching the comment in the old code.
// If the env var is absent (= 0) the function falls back to created_by only,
// preserving the previous behaviour without breaking anything.
function noteBelongsToManager(
  note: AmoNote,
  managerId: number,
  leadMap: Map<number, AmoLead>,
  wazzupBotUserId: number,
): boolean {
  if (note.created_by === managerId) return true
  if (wazzupBotUserId > 0 && note.created_by === wazzupBotUserId) {
    return leadMap.get(note.entity_id)?.responsible_user_id === managerId
  }
  return false
}

// ── Stage → zone mapping (воронка "Продажи", точные названия этапов) ──────────
// Зона 1 — квалификация:  Получена новая заявка … Готов купить
// Зона 2 — продажа:       Замер назначен … Счёт выставлен — ждём оплату
// Зона 3 — производство:  Оплата сделана … Оплата дизайнером

function stageZone(name: string): 1 | 2 | 3 | null {
  const n = name.toLowerCase()

  // Зона 1: квалификация / прогрев
  if (n.includes('новая заявка')       ||
      n.includes('назначен ответственный') ||
      n.includes('проработка')         ||
      n.includes('разговор состоялся') ||
      n.includes('долгострой')         ||
      n.includes('готов купить')) return 1

  // Зона 2: замер → чертежи → кп → счёт
  if (n.includes('замер')              ||
      n.includes('согласование')       ||
      n.includes('чертежи в работу')   ||
      n.startsWith('кп')              ||
      n.includes('счёт выставлен')    || n.includes('счет выставлен') ||
      n.includes('ждём оплату')       || n.includes('ждем оплату')) return 2

  // Зона 3: производство / монтаж / оплаты
  if (n.includes('оплата сделана')     ||
      n.includes('оплата получена')    ||
      n.includes('счёт оплачен')      || n.includes('счет оплачен') ||
      n.includes('заказ в работе')     ||
      n.includes('к монтажу')          ||
      n.includes('монтаж')             ||
      n.includes('рекламация')         ||
      n.includes('оплата остатка')     ||
      n.includes('оплата дизайнером')) return 3

  return null
}

// ── Activity window helpers ────────────────────────────────────────────────────

type ManagerActivityEvent = {
  source:    'event'
  type:      string
  timestamp: number
  managerId: number
  leadId?:   number
}

// Events that indicate client action or system noise, not manager initiative.
const EXCLUDED_ACTIVITY_EVENT_TYPES = new Set([
  'incoming_chat_message',
  'talk_missed_event',
  'call_missed',
])

function getActivityTimeline(myEvents: AmoEvent[], todayStart: number): ManagerActivityEvent[] {
  return myEvents
    .filter(event => event.created_at >= todayStart)
    .filter(event => !EXCLUDED_ACTIVITY_EVENT_TYPES.has(event.type))
    .map(event => ({
      source:    'event' as const,
      type:      event.type,
      timestamp: event.created_at,
      managerId: event.created_by,
      leadId:    event.entity_type === 'leads' ? event.entity_id : undefined,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

function formatMoscowTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('ru-RU', {
    hour:     '2-digit',
    minute:   '2-digit',
    timeZone: 'Europe/Moscow',
  })
}

function formatMinutes(totalMinutes: number): string {
  const hours   = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}м`
  return minutes > 0 ? `${hours}ч${minutes}м` : `${hours}ч`
}

function computeActivityGaps(
  timeline:         ManagerActivityEvent[],
  todayStart:       number,
  thresholdMinutes = 60,
): { bigPausesCount: number; maxPauseMinutes: number } {
  const workStart  = todayStart + 9  * 3600
  const workEnd    = todayStart + 18 * 3600
  const workEvents = timeline.filter(event => event.timestamp >= workStart && event.timestamp < workEnd)
  let bigPausesCount  = 0
  let maxPauseMinutes = 0
  for (let index = 1; index < workEvents.length; index++) {
    const gapMinutes = Math.floor(
      (workEvents[index].timestamp - workEvents[index - 1].timestamp) / 60,
    )
    if (gapMinutes > thresholdMinutes) {
      bigPausesCount++
      maxPauseMinutes = Math.max(maxPauseMinutes, gapMinutes)
    }
  }
  return { bigPausesCount, maxPauseMinutes }
}

function computeActivityTimeBlocks(
  timeline:   ManagerActivityEvent[],
  todayStart: number,
): { morningEvents: number; dayEvents: number; eveningEvents: number } {
  const morningStart = todayStart + 9  * 3600
  const dayStart     = todayStart + 12 * 3600
  const eveningStart = todayStart + 16 * 3600
  const eveningEnd   = todayStart + 20 * 3600
  let morningEvents = 0
  let dayEvents     = 0
  let eveningEvents = 0
  for (const event of timeline) {
    if      (event.timestamp >= morningStart && event.timestamp < dayStart)     morningEvents++
    else if (event.timestamp >= dayStart     && event.timestamp < eveningStart) dayEvents++
    else if (event.timestamp >= eveningStart && event.timestamp < eveningEnd)   eveningEvents++
  }
  return { morningEvents, dayEvents, eveningEvents }
}

// ── Types ──────────────────────────────────────────────────────────────────────

type StaleInfo = { id: number; name: string; daysStale: number; stageName: string }

export type ManagerMetrics = {
  user:                AmoUser
  newLeadsToday:       number
  messagesSent:        number
  callsMade:           number
  cardsMoved:          number
  activeLeads:         number
  zone1:               number
  zone2:               number
  zone3:               number
  staleZone1:          StaleInfo[]
  staleZone2:          StaleInfo[]
  staleZone3:          StaleInfo[]
  invoiceStale:        StaleInfo[]
  firstActivityAt:     number | null
  lastActivityAt:      number | null
  activityEventsCount: number
  bigPausesCount:      number
  maxPauseMinutes:     number
  morningEvents:       number
  dayEvents:           number
  eveningEvents:       number
}

// ── Collect ────────────────────────────────────────────────────────────────────

export async function collectAllMetrics(): Promise<ManagerMetrics[]> {
  const now        = new Date()
  const todayStart = getMoscowDayStartUnix(now)   // 00:00:00 Europe/Moscow
  const nowTs      = Math.floor(now.getTime() / 1000)
  const DAY        = 86400

  const wazzupBotUserId = Number(process.env.AMO_WAZZUP_BOT_USER_ID || 0)

  // All IDs from AMOCRM_MANAGERS_IDS appear in the report — no exclusions.
  // To remove a manager from the report, remove them from the env var.
  const managerIds = (process.env.AMOCRM_MANAGERS_IDS ?? '')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(id => id > 0)

  if (managerIds.length === 0) throw new Error('AMOCRM_MANAGERS_IDS is empty or not set')

  // /events correctly filters by created_at.
  // /leads/notes ignores filter[created_at] and requires filter[updated_at] to return today's notes.
  const eventsDateFilter = {
    'filter[created_at][from]': String(todayStart),
    'filter[created_at][to]':   String(nowTs),
  }
  const notesDateFilter = {
    'filter[updated_at][from]': String(todayStart),
    'filter[updated_at][to]':   String(nowTs),
  }

  // Parallel: users, pipelines, today-events, today-notes, all-leads.
  // getEvents / getLeadNotes use amoGetAll internally — no 250-item cap.
  const [users, pipelines, todayEvents, todayNotes, allLeads] = await Promise.all([
    getUsers(),
    getPipelines(),
    getEvents(eventsDateFilter),
    getLeadNotes(notesDateFilter),
    getLeads({}),
  ])

  // Find the main "Продажи" sales pipeline by name (or via AMOCRM_SALES_PIPELINE_ID env var)
  const salesPipeline = pipelines.find(p =>
    p.name.toLowerCase().includes('продаж') ||
    String(p.id) === (process.env.AMOCRM_SALES_PIPELINE_ID ?? '')
  ) ?? pipelines[0]

  // Stage map: only from the sales pipeline — other pipelines have different stage names
  const stageMap = new Map<number, { name: string; zone: 1 | 2 | 3 | null }>()
  for (const s of salesPipeline?._embedded?.statuses ?? []) {
    stageMap.set(s.id, { name: s.name, zone: stageZone(s.name) })
  }

  // Filter to sales pipeline only — removes B2B and other pipeline leads from counts
  const salesLeads = salesPipeline
    ? allLeads.filter(l => l.pipeline_id === salesPipeline.id)
    : allLeads

  // Active leads: not closed
  const activeLeads = salesLeads.filter(l => l.closed_at === null && l.status_id !== 142 && l.status_id !== 143)

  // Lead map for Wazzup note attribution (note.entity_id → lead)
  const leadMap = new Map(allLeads.map(l => [l.id, l]))

  // Map user ID → AmoUser
  const userMap = new Map(users.map(u => [u.id, u]))

  return managerIds.map(uid => {
    const user = userMap.get(uid) ?? { id: uid, name: `Менеджер #${uid}`, email: '' }

    const myEvents = todayEvents.filter((e: AmoEvent) => e.created_by === uid)
    const myNotes  = todayNotes.filter(n => noteBelongsToManager(n, uid, leadMap, wazzupBotUserId))

    const activityTimeline   = getActivityTimeline(myEvents, todayStart)
    const firstActivityAt    = activityTimeline[0]?.timestamp ?? null
    const lastActivityAt     = activityTimeline[activityTimeline.length - 1]?.timestamp ?? null
    const { bigPausesCount, maxPauseMinutes } = computeActivityGaps(activityTimeline, todayStart)
    const { morningEvents, dayEvents, eveningEvents } = computeActivityTimeBlocks(activityTimeline, todayStart)

    const newLeadsToday = salesLeads.filter(l => l.responsible_user_id === uid && l.created_at >= todayStart).length

    // Phone calls: call notes (call_out/call_in or legacy 4/13) with params.duration > 0.
    const callsMade = myNotes.filter(n =>
      (noteTypeIs(n.note_type, 'call_out', 4) || noteTypeIs(n.note_type, 'call_in', 13)) &&
      (n.params?.duration ?? 0) > 0
    ).length

    // Messages: outgoing_chat_message events created directly by the manager.
    // Wazzup does not write notes to /leads/notes — chat activity only appears in /events.
    // myEvents is already filtered to created_by === uid, so this counts only the manager's own sends.
    // Events with created_by=0 (system/bot) are excluded automatically.
    const messagesSent = myEvents.filter(e => e.type === 'outgoing_chat_message').length

    const cardsMoved = myEvents.filter(e => e.type === 'lead_status_changed').length

    const myLeads = activeLeads.filter(l => l.responsible_user_id === uid)

    const staleZone1: StaleInfo[] = []
    const staleZone2: StaleInfo[] = []
    const staleZone3: StaleInfo[] = []
    const invoiceStale: StaleInfo[] = []

    for (const lead of myLeads) {
      const stage      = stageMap.get(lead.status_id)
      if (!stage) continue
      const daysStale  = Math.floor((nowTs - lead.updated_at) / DAY)
      const { name: stageName, zone } = stage

      if (zone === 1 && daysStale >= 2)
        staleZone1.push({ id: lead.id, name: lead.name, daysStale, stageName })
      if (zone === 2) {
        if (daysStale >= 3) staleZone2.push({ id: lead.id, name: lead.name, daysStale, stageName })
        const isInvoice = stageName.toLowerCase().includes('счёт') || stageName.toLowerCase().includes('ждем')
        if (isInvoice && daysStale >= 5) invoiceStale.push({ id: lead.id, name: lead.name, daysStale, stageName })
      }
      if (zone === 3 && daysStale >= 3)
        staleZone3.push({ id: lead.id, name: lead.name, daysStale, stageName })
    }

    const sort = (a: StaleInfo, b: StaleInfo) => b.daysStale - a.daysStale

    return {
      user,
      newLeadsToday,
      messagesSent,
      callsMade,
      cardsMoved,
      activeLeads:         myLeads.length,
      zone1:               myLeads.filter(l => stageMap.get(l.status_id)?.zone === 1).length,
      zone2:               myLeads.filter(l => stageMap.get(l.status_id)?.zone === 2).length,
      zone3:               myLeads.filter(l => stageMap.get(l.status_id)?.zone === 3).length,
      staleZone1:          staleZone1.sort(sort),
      staleZone2:          staleZone2.sort(sort),
      staleZone3:          staleZone3.sort(sort),
      invoiceStale:        invoiceStale.sort(sort),
      firstActivityAt,
      lastActivityAt,
      activityEventsCount: activityTimeline.length,
      bigPausesCount,
      maxPauseMinutes,
      morningEvents,
      dayEvents,
      eveningEvents,
    }
  })
}

// ── Report ─────────────────────────────────────────────────────────────────────

function ropFlags(m: ManagerMetrics, todayStart: number): string[] {
  const flags: string[] = []

  if (m.messagesSent === 0 && m.callsMade === 0 && m.activeLeads > 0)
    flags.push('🔴 Нулевая исходящая активность')
  else if (m.messagesSent === 0 && m.callsMade > 0)
    flags.push('🟡 Нет сообщений — только звонки')
  else if (m.callsMade === 0 && m.activeLeads > 5)
    flags.push('🟡 Нет звонков при большом портфеле')

  if (m.cardsMoved === 0 && m.activeLeads > 3)
    flags.push('🔴 Ни одного перемещения — сделки стоят')

  if (m.staleZone1.length > 0)
    flags.push(`🔴 ${m.staleZone1.length} лидов без касания >2д`)

  if (m.invoiceStale.length > 0)
    flags.push(`🔴 Счёт без оплаты >5д — ${m.invoiceStale.length} шт`)

  if (m.staleZone2.length > 0)
    flags.push(`🟠 ${m.staleZone2.length} сделок без движения >3д (зона2)`)

  if (m.staleZone3.length > 0)
    flags.push(`🟡 ${m.staleZone3.length} производственных без обновления >3д`)

  if (m.activeLeads >= 50)
    flags.push(`⚠️ Высокая нагрузка: ${m.activeLeads} активных сделок`)

  // CRM activity flags — show when manager has zero events but the outgoing flag
  // (calls + messages) hasn't already signalled the same case.
  const outgoingAlreadyFlagged = m.messagesSent === 0 && m.callsMade === 0 && m.activeLeads > 0
  if (m.activityEventsCount === 0 && m.activeLeads > 0 && !outgoingAlreadyFlagged)
    flags.push('🔴 Нулевая активность в AmoCRM')

  if (m.firstActivityAt && m.firstActivityAt > todayStart + 11 * 3600)
    flags.push('🔴 Первая активность в CRM после 11:00')

  if (m.lastActivityAt && m.lastActivityAt < todayStart + 15 * 3600 && m.activeLeads > 3)
    flags.push('🔴 Активность в CRM до 15:00 — ранний выход')

  if (m.bigPausesCount > 0)
    flags.push(`🟠 Пауза без активности >60м${m.bigPausesCount > 1 ? ` (${m.bigPausesCount}×)` : ''}`)

  if (m.activityEventsCount > 0 && m.activityEventsCount < 10 && m.activeLeads > 3)
    flags.push(`🟠 Мало событий в CRM за день: ${m.activityEventsCount}`)

  if (m.eveningEvents === 0 && m.activeLeads > 5 && m.activityEventsCount > 0)
    flags.push('🟡 Нет активности в CRM после 16:00')

  return flags
}

export function buildReport(metrics: ManagerMetrics[]): string {
  const now        = new Date()
  const todayStart = getMoscowDayStartUnix(now)
  const date       = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })
  const lines: string[] = []

  // ── Header ────────────────────────────────────────────────────────────────────
  lines.push(`📊 <b>Отчёт ОП — ${date}, 18:00</b>`)

  // ── Team totals ───────────────────────────────────────────────────────────────
  const totalLeads  = metrics.reduce((s, m) => s + m.newLeadsToday, 0)
  const totalMsgs   = metrics.reduce((s, m) => s + m.messagesSent, 0)
  const totalCalls  = metrics.reduce((s, m) => s + m.callsMade, 0)
  const totalMoves  = metrics.reduce((s, m) => s + m.cardsMoved, 0)
  const totalActive = metrics.reduce((s, m) => s + m.activeLeads, 0)
  const redCount    = metrics.filter(m => ropFlags(m, todayStart).some(f => f.startsWith('🔴'))).length

  lines.push('<b>ИТОГО:</b>')
  lines.push(`Лидов: ${totalLeads} | Сообщ: ${totalMsgs} | Звонков: ${totalCalls} | Движений: ${totalMoves}`)
  lines.push(`Активных сделок: ${totalActive}`)
  if (redCount > 0) lines.push(`🔴 Красных флагов: ${redCount}`)

  // ── Per manager ───────────────────────────────────────────────────────────────
  for (const m of metrics) {
    const firstName = m.user.name.split(' ')[0]

    lines.push('')
    lines.push('━━━━━━━━━━━━━━━━━━')
    lines.push(`👤 <b>${firstName}</b>`)
    lines.push(`Активность: лиды ${m.newLeadsToday} | сообщ ${m.messagesSent} | звонки ${m.callsMade} | движ ${m.cardsMoved}`)
    if (m.activityEventsCount > 0 && m.firstActivityAt && m.lastActivityAt) {
      lines.push(
        `CRM: ${formatMoscowTime(m.firstActivityAt)}–${formatMoscowTime(m.lastActivityAt)}` +
        ` | событий ${m.activityEventsCount} | пауз >60м: ${m.bigPausesCount}`,
      )
    }
    lines.push(`Сделки: активные ${m.activeLeads} | квалиф ${m.zone1} | продажа ${m.zone2} | оплата/пр-во ${m.zone3}`)
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  lines.push('')
  lines.push('━━━━━━━━━━━━━━━━━━')
  lines.push(ropSummary(metrics))
  return lines.join('\n')
}

function ropSummary(metrics: ManagerMetrics[]): string {
  const bullets: string[] = []
  const avgActive = metrics.reduce((s, m) => s + m.activeLeads, 0) / (metrics.length || 1)

  for (const m of metrics) {
    const name = m.user.name.split(' ')[0]

    if (m.messagesSent === 0 && m.callsMade === 0 && m.activeLeads > 0)
      bullets.push(`${name} — 0 звонков, 0 сообщений`)

    if (m.activeLeads > Math.max(avgActive * 1.5, avgActive + 20))
      bullets.push(`${name} — высокая нагрузка: ${m.activeLeads} активных сделок`)

    if (m.bigPausesCount > 0)
      bullets.push(`${name} — пауза без активности >60м`)
  }

  if (!bullets.length) return '🧠 <b>Вывод РОП:</b> Команда в норме.'
  return '🧠 <b>Вывод РОП:</b>\n' + bullets.map(b => `• ${b}`).join('\n')
}
