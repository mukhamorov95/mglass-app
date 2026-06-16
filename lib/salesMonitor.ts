// Sales monitor — collects AmoCRM data and generates ROP-level insights.
// READ-ONLY: never writes to CRM cards.

import {
  getUsers, getPipelines, getLeads, getEvents, getLeadNotes, getDomain,
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

// ── Types ──────────────────────────────────────────────────────────────────────

type StaleInfo = { id: number; name: string; daysStale: number; stageName: string }

export type ManagerMetrics = {
  user:          AmoUser
  newLeadsToday: number
  messagesSent:  number
  callsMade:     number
  cardsMoved:    number
  activeLeads:   number
  zone1:         number
  zone2:         number
  zone3:         number
  staleZone1:    StaleInfo[]
  staleZone2:    StaleInfo[]
  staleZone3:    StaleInfo[]
  invoiceStale:  StaleInfo[]
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
      activeLeads:   myLeads.length,
      zone1:         myLeads.filter(l => stageMap.get(l.status_id)?.zone === 1).length,
      zone2:         myLeads.filter(l => stageMap.get(l.status_id)?.zone === 2).length,
      zone3:         myLeads.filter(l => stageMap.get(l.status_id)?.zone === 3).length,
      staleZone1:    staleZone1.sort(sort),
      staleZone2:    staleZone2.sort(sort),
      staleZone3:    staleZone3.sort(sort),
      invoiceStale:  invoiceStale.sort(sort),
    }
  })
}

// ── Report ─────────────────────────────────────────────────────────────────────

function link(id: number, name: string) {
  return `<a href="https://${getDomain()}/leads/detail/${id}">${name}</a>`
}

// Top N stale deals across all zones, sorted by days descending.
// Marks "Долгострой" stage with 🧊 to distinguish chronic from fresh stale.
function topProblems(m: ManagerMetrics, limit = 2): string {
  const all = [...m.staleZone1, ...m.invoiceStale, ...m.staleZone2, ...m.staleZone3]
    .sort((a, b) => b.daysStale - a.daysStale)
  const seen = new Set<number>()
  const unique = all.filter(s => {
    if (seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })
  if (unique.length === 0) return ''
  return unique.slice(0, limit)
    .map((s, i) => {
      const isDolgo = s.stageName.toLowerCase().includes('долгострой')
      return `  ${i + 1}. ${link(s.id, s.name)} — ${s.daysStale}д, ${s.stageName}${isDolgo ? ' 🧊' : ''}`
    })
    .join('\n')
}

function ropFlags(m: ManagerMetrics): string[] {
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

  return flags
}

export function buildReport(metrics: ManagerMetrics[]): string {
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })
  const lines: string[] = []

  // ── Header ────────────────────────────────────────────────────────────────────
  lines.push(`📊 <b>Отчёт ОП — ${date}, 18:00</b>`)

  // ── Team totals ───────────────────────────────────────────────────────────────
  const totalLeads  = metrics.reduce((s, m) => s + m.newLeadsToday, 0)
  const totalMsgs   = metrics.reduce((s, m) => s + m.messagesSent, 0)
  const totalCalls  = metrics.reduce((s, m) => s + m.callsMade, 0)
  const totalMoves  = metrics.reduce((s, m) => s + m.cardsMoved, 0)
  const totalActive = metrics.reduce((s, m) => s + m.activeLeads, 0)
  const redCount    = metrics.filter(m => ropFlags(m).some(f => f.startsWith('🔴'))).length

  lines.push('<b>ИТОГО:</b>')
  lines.push(`Лидов: ${totalLeads} | Сообщ: ${totalMsgs} | Звонков: ${totalCalls} | Движений: ${totalMoves}`)
  lines.push(`Активных сделок: ${totalActive}`)
  if (redCount > 0) lines.push(`🔴 Красных флагов: ${redCount}`)

  // ── Per manager ───────────────────────────────────────────────────────────────
  for (const m of metrics) {
    const firstName = m.user.name.split(' ')[0]
    const flags     = ropFlags(m)
    const problems  = topProblems(m)

    lines.push('')
    lines.push('━━━━━━━━━━━━━━━━━━')
    lines.push(`👤 <b>${firstName}</b>`)
    lines.push(`Активность: лиды ${m.newLeadsToday} | сообщ ${m.messagesSent} | звонки ${m.callsMade} | движ ${m.cardsMoved}`)
    lines.push(`Сделки: активные ${m.activeLeads} | квалиф ${m.zone1} | продажа ${m.zone2} | оплата/пр-во ${m.zone3}`)

    const staleTotal = m.staleZone1.length + m.staleZone2.length + m.staleZone3.length + m.invoiceStale.length
    if (staleTotal > 0) {
      const invoicePart = m.invoiceStale.length > 0 ? ` | счета ${m.invoiceStale.length}` : ''
      lines.push(`Риски: зона1 ${m.staleZone1.length} | зона2 ${m.staleZone2.length} | зона3 ${m.staleZone3.length}${invoicePart}`)
    }

    if (flags.length > 0) {
      lines.push('⚠️ <b>Главное:</b>')
      for (const f of flags) lines.push(`• ${f}`)
      if (problems) {
        lines.push('Топ проблем:')
        lines.push(problems)
      }
    } else {
      lines.push('✅ Критичных зависаний нет')
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  lines.push('')
  lines.push('━━━━━━━━━━━━━━━━━━')
  lines.push(ropSummary(metrics))
  return lines.join('\n')
}

function ropSummary(metrics: ManagerMetrics[]): string {
  const bullets: string[] = []

  // Zero activity — only flag managers who have active deals but did nothing today
  for (const m of metrics) {
    if (m.messagesSent === 0 && m.callsMade === 0 && m.activeLeads > 0) {
      bullets.push(`Нет активности: ${m.user.name.split(' ')[0]} — 0 звонков, 0 сообщений`)
    }
  }

  // Overload — manager with significantly more active deals than the team average
  const avgActive = metrics.reduce((s, m) => s + m.activeLeads, 0) / (metrics.length || 1)
  for (const m of metrics) {
    if (m.activeLeads > Math.max(avgActive * 1.5, avgActive + 20)) {
      bullets.push(`Перегруз по активным сделкам: ${m.user.name.split(' ')[0]} — ${m.activeLeads}`)
    }
  }

  // Most stale leads (fresh leads only — exclude if all stale are "долгострой")
  const mostStale = [...metrics].sort(
    (a, b) => (b.staleZone1.length + b.staleZone2.length) - (a.staleZone1.length + a.staleZone2.length),
  )[0]
  if (mostStale) {
    const freshStale = mostStale.staleZone1.filter(s => !s.stageName.toLowerCase().includes('долгострой')).length
      + mostStale.staleZone2.length
    if (freshStale >= 3) {
      bullets.push(`Зависших лидов больше всего: ${mostStale.user.name.split(' ')[0]} — ${freshStale} (свежие зона1+2)`)
    }
  }

  if (!bullets.length) return '🧠 <b>Вывод РОП:</b> Команда в норме. Следите за счетами.'
  return '🧠 <b>Вывод РОП:</b>\n' + bullets.map(b => `• ${b}`).join('\n')
}
