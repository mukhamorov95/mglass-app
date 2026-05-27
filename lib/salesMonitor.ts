// Sales monitor — collects AmoCRM data and generates ROP-level insights.
// READ-ONLY: never writes to CRM cards.

import {
  getUsers, getPipelines, getLeads, amoGet, getDomain,
  type AmoUser, type AmoEvent, type AmoNote,
} from '@/lib/amocrm'

// ── Stage → zone mapping (по названию этапа) ──────────────────────────────────
// Зона 1: квалификация  — "Назначен ответственный" … "Готов купить"
// Зона 2: продажа       — "Замер назначен" … "Счёт выставлен - ждем оплату"
// Зона 3: производство  — "Оплата сделана, чертежи не готовы" … "Оплата остатка"

function stageZone(name: string): 1 | 2 | 3 | null {
  const n = name.toLowerCase()
  // Zone 1: квалификация
  if (n.includes('назначен ответственный') || n.includes('проработка') ||
      n.includes('разговор состоялся') || n.includes('долгострой') ||
      n.includes('первичный') || n.includes('выяснение') ||
      n.includes('думает') || n.includes('в работе') ||
      n.includes('готов купить')) return 1
  // Zone 2: продажа (замер, согласование, КП, счёт)
  if (n.includes('замер') || n.includes('согласование после замера') ||
      n.startsWith('кп') || n.includes('коммерческое') ||
      n.includes('счёт') || n.includes('счет') || n.includes('ждем')) return 2
  // Zone 3: производство / оплата
  if (n.includes('оплата сделана') || n.includes('чертежи') ||
      n.includes('производстве') || n.includes('доставк') ||
      n.includes('монтаж') || n.includes('остатка') ||
      n.includes('оплата получена') || n.includes('согласование после отправки')) return 3
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
  const todayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
  const nowTs      = Math.floor(now.getTime() / 1000)
  const DAY        = 86400

  // Manager IDs from env — exclude owner (AMO_VLADISLAV_USER_ID)
  const ownerIdStr  = process.env.AMO_VLADISLAV_USER_ID ?? ''
  const managerIds  = (process.env.AMOCRM_MANAGERS_IDS ?? '')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(id => id && String(id) !== ownerIdStr)

  if (managerIds.length === 0) throw new Error('AMOCRM_MANAGERS_IDS is empty or not set')

  // Parallel: users, pipelines, today-events, today-notes, all-active-leads
  // Events and notes use single-page amoGet (limit=250) — one day never exceeds 250 records
  const [users, pipelines, eventsData, notesData, allLeads] = await Promise.all([
    getUsers(),
    getPipelines(),
    amoGet<{ _embedded: { events: AmoEvent[] } }>('/events', {
      'filter[created_at][from]': String(todayStart),
      'filter[created_at][to]':   String(nowTs),
      limit: '250',
    }),
    // note_type 4=исходящий звонок, 13=входящий, 10=SMS, 1=текстовое примечание
    amoGet<{ _embedded: { notes: AmoNote[] } }>('/leads/notes', {
      'filter[note_type]': '4,10,1',
      'filter[created_at][from]': String(todayStart),
      'filter[created_at][to]':   String(nowTs),
      limit: '250',
    }),
    // Fetch all leads — AmoCRM ignores comma-separated responsible_user_id filter,
    // so we fetch everything and filter client-side.
    getLeads({}),
  ])

  const todayEvents = eventsData?._embedded?.events ?? []
  const todayNotes  = notesData?._embedded?.notes ?? []

  // Stage map: id → { name, zone }
  const stageMap = new Map<number, { name: string; zone: 1 | 2 | 3 | null }>()
  for (const p of pipelines) {
    for (const s of p._embedded?.statuses ?? []) {
      stageMap.set(s.id, { name: s.name, zone: stageZone(s.name) })
    }
  }

  // Active leads: closed_at === null is authoritative; status_id 142/143 are fallbacks
  const activeLeads = allLeads.filter(l => l.closed_at === null && l.status_id !== 142 && l.status_id !== 143)

  // Map user ID → AmoUser
  const userMap = new Map(users.map(u => [u.id, u]))

  return managerIds.map(uid => {
    const user = userMap.get(uid) ?? { id: uid, name: `Manager #${uid}`, email: '' }

    const myEvents = todayEvents.filter((e: AmoEvent) => e.created_by === uid)
    const myNotes  = todayNotes.filter((n: AmoNote) => n.created_by === uid)

    const newLeadsToday = allLeads.filter(l => l.responsible_user_id === uid && l.created_at >= todayStart).length
    const callsMade     = myNotes.filter(n => n.note_type === 4 || n.note_type === 13).length
    const messagesSent  = myNotes.filter(n => n.note_type === 10 || n.note_type === 1).length
    const cardsMoved    = myEvents.filter(e => e.type === 'lead_status_changed').length

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

function staleLines(items: StaleInfo[], limit = 2) {
  return items.slice(0, limit)
    .map(s => `    └ ${link(s.id, s.name)} — ${s.daysStale}д (${s.stageName})`)
    .join('\n')
}

function ropFlags(m: ManagerMetrics): string[] {
  const flags: string[] = []

  if (m.messagesSent === 0 && m.callsMade === 0)
    flags.push('🔴 Ноль исходящей активности за день')
  else if (m.messagesSent === 0)
    flags.push('🟡 Нет сообщений — только звонки, нет письменных договорённостей')
  else if (m.callsMade === 0 && m.activeLeads > 5)
    flags.push('🟡 Нет звонков при большом портфеле')

  if (m.cardsMoved === 0 && m.activeLeads > 3)
    flags.push('🔴 Ни одного перемещения — сделки стоят на месте')

  if (m.staleZone1.length > 0) {
    flags.push(`🔴 Зона 1: ${m.staleZone1.length} лид(ов) без касания >2д\n${staleLines(m.staleZone1)}`)
  }
  if (m.invoiceStale.length > 0) {
    flags.push(`🔴 Счёт без оплаты >5д (${m.invoiceStale.length} шт)\n${staleLines(m.invoiceStale)}`)
  }
  if (m.staleZone2.length > 0) {
    flags.push(`🟠 Зона 2: ${m.staleZone2.length} сделок без движения >3д\n${staleLines(m.staleZone2)}`)
  }
  if (m.staleZone3.length > 0) {
    flags.push(`🟡 Зона 3: ${m.staleZone3.length} производственных без обновления >3д\n${staleLines(m.staleZone3)}`)
  }

  if (flags.length === 0) flags.push('✅ Флагов нет')
  return flags
}

export function buildReport(metrics: ManagerMetrics[]): string {
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  const lines = [`📊 <b>Отчёт ОП — ${date}, 18:00</b>`]

  for (const m of metrics) {
    const name = m.user.name.split(' ')[0]
    lines.push('')
    lines.push('━━━━━━━━━━━━━━━━━━')
    lines.push(`👤 <b>${name}</b>  |  активных сделок: <b>${m.activeLeads}</b>`)
    lines.push(`Лидов: <b>${m.newLeadsToday}</b>  Сообщ: <b>${m.messagesSent}</b>  Звонков: <b>${m.callsMade}</b>  Перемещений: <b>${m.cardsMoved}</b>`)
    lines.push(`🔵 Квалификация: ${m.zone1}  🟠 Продажа: ${m.zone2}  🟢 Оплата/Пр-во: ${m.zone3}`)
    for (const f of ropFlags(m)) lines.push(f)
  }

  lines.push('')
  lines.push('━━━━━━━━━━━━━━━━━━')
  lines.push(ropSummary(metrics))
  return lines.join('\n')
}

function ropSummary(metrics: ManagerMetrics[]): string {
  const bullets: string[] = []

  const inactive = metrics.filter(m => m.messagesSent + m.callsMade === 0)
  if (inactive.length)
    bullets.push(`${inactive.map(m => m.user.name.split(' ')[0]).join(', ')} — нулевая исходящая активность, разобрать на утро`)

  const [top, ...rest] = [...metrics].sort((a, b) => b.activeLeads - a.activeLeads)
  if (rest.length && top.activeLeads - rest[rest.length - 1].activeLeads > 10)
    bullets.push(`Дисбаланс нагрузки: у ${top.user.name.split(' ')[0]} на ${top.activeLeads - rest[rest.length - 1].activeLeads} сделок больше`)

  const mostStale = [...metrics].sort(
    (a, b) => (b.staleZone1.length + b.staleZone2.length) - (a.staleZone1.length + a.staleZone2.length)
  )[0]
  if (mostStale && mostStale.staleZone1.length + mostStale.staleZone2.length >= 3)
    bullets.push(`${mostStale.user.name.split(' ')[0]} — больше всего зависших лидов, начать завтра с разбора`)

  if (!bullets.length) return '🧠 <b>Вывод РОП:</b> Команда в норме. Следите за счетами.'
  return '🧠 <b>Вывод РОП:</b>\n' + bullets.map(b => `• ${b}`).join('\n')
}
