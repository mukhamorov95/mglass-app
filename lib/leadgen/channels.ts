// Табло «Откуда деньги»: каналы B2C по сделкам воронки «Продажи» AmoCRM.
// Канал — поле сделки «ИСТОЧНИК СДЕЛКИ»; если оно пустое — известный тег; иначе «Не указан».
// Оплачено = этап зоны 3 или «реализовано успешно» (142); до замера = зона 2 и дальше.
// Чистые функции — загрузка из AmoCRM в lib/leadgen/loadSalesLeads.ts.

import type { FunnelZone } from '@/lib/funnelZones'

export type ChannelLead = {
  id: number
  price?: number | null
  status_id: number
  created_at: number
  closed_at?: number | null
  custom_fields_values?: { field_name: string; values: { value: unknown }[] }[] | null
  _embedded?: { tags?: { name: string }[] }
}

export type ChannelGroup = 'relations' | 'site' | 'avito' | 'other' | 'unknown'

export const GROUP_LABEL: Record<ChannelGroup, string> = {
  relations: 'Отношения: партнёры, рекомендации, повтор',
  site:      'Сайт и звонки',
  avito:     'Авито',
  other:     'Прочее',
  unknown:   'Источник не указан',
}

export const GROUP_ORDER: ChannelGroup[] = ['relations', 'site', 'avito', 'other', 'unknown']

export const UNKNOWN_SOURCE = 'Не указан'

// До апреля 2026 менеджеры заводили сделку, когда клиент почти куплен; с апреля — каждое
// обращение (подключили Авито). Конверсию через эту границу сравнивать нельзя.
export const RECORDING_CHANGE_MONTH = '2026-04'

const WON = 142
const LOST = 143
const SOURCE_FIELD = 'ИСТОЧНИК СДЕЛКИ'
const DIRECT_CLICK_FIELD = 'yclid'

const TAG_SOURCES: [RegExp, string][] = [
  [/^авито$/i, 'Авито'],
  [/^(партн[её]р|дизайнер)/i, 'Партнёр'],
  [/^рекомендац/i, 'По рекомендации'],
  [/^повторный заказ$/i, 'Повторный заказ'],
  [/^энвибокс$/i, 'Энвибокс'],
  [/^инстаграм/i, 'Инстаграмм'],
  [/^перехват$/i, 'Сергей Перехват'],
  [/^victory$/i, 'Victory (Посещали наш сайт)'],
]

function fieldValue(lead: ChannelLead, name: string): string | null {
  const f = lead.custom_fields_values?.find(c => c.field_name === name)
  const v = f?.values?.map(x => String(x.value ?? '')).join(' ').replace(/\s+/g, ' ').trim()
  return v ? v : null
}

export function leadSource(lead: ChannelLead): string {
  const field = fieldValue(lead, SOURCE_FIELD)
  if (field) return field
  for (const tag of lead._embedded?.tags ?? []) {
    const hit = TAG_SOURCES.find(([re]) => re.test(tag.name.trim()))
    if (hit) return hit[1]
  }
  return UNKNOWN_SOURCE
}

export function channelGroup(source: string): ChannelGroup {
  if (source === UNKNOWN_SOURCE) return 'unknown'
  if (/авито/i.test(source)) return 'avito'
  if (/партн|рекоменд|повтор/i.test(source)) return 'relations'
  if (/сайт|ватсап|телеграм|энвибокс|victory|звонок/i.test(source)) return 'site'
  return 'other'
}

export function hasDirectClick(lead: ChannelLead): boolean {
  return fieldValue(lead, DIRECT_CLICK_FIELD) !== null
}

export function moscowMonth(unix: number): string {
  return new Date((unix + 3 * 3600) * 1000).toISOString().slice(0, 7)
}

// Серверная страница рендерится один раз на запрос — текущее время здесь стабильно.
export function nowUnix(): number {
  return Date.now() / 1000
}

export type ZoneOf = (statusId: number) => FunnelZone | null

export function outcome(lead: ChannelLead, zoneOf: ZoneOf): { measured: boolean; paid: boolean } {
  const zone = zoneOf(lead.status_id)
  const paid = lead.status_id === WON || zone === 3
  return { paid, measured: paid || zone === 2 }
}

export type Stats = { deals: number; measured: number; paid: number; paidSum: number; lost: number }

const emptyStats = (): Stats => ({ deals: 0, measured: 0, paid: 0, paidSum: 0, lost: 0 })

function add(s: Stats, lead: ChannelLead, zoneOf: ZoneOf) {
  const o = outcome(lead, zoneOf)
  s.deals++
  if (o.measured) s.measured++
  if (o.paid) { s.paid++; s.paidSum += Number(lead.price) || 0 }
  if (lead.status_id === LOST) s.lost++
}

export type SourceRow = { source: string; stats: Stats }
export type GroupBlock = { group: ChannelGroup; stats: Stats; rows: SourceRow[] }
export type ChannelTable = { groups: GroupBlock[]; total: Stats; direct: Stats }

export function inWindow(lead: ChannelLead, from: string, to: string): boolean {
  const m = moscowMonth(lead.created_at)
  return m >= from && m <= to
}

export function buildChannelTable(leads: ChannelLead[], zoneOf: ZoneOf, from: string, to: string): ChannelTable {
  const bySource = new Map<string, Stats>()
  const total = emptyStats()
  const direct = emptyStats()
  for (const lead of leads) {
    if (!inWindow(lead, from, to)) continue
    const src = leadSource(lead)
    const s = bySource.get(src) ?? emptyStats()
    add(s, lead, zoneOf)
    bySource.set(src, s)
    add(total, lead, zoneOf)
    if (hasDirectClick(lead)) add(direct, lead, zoneOf)
  }
  const groups: GroupBlock[] = []
  for (const group of GROUP_ORDER) {
    const rows = [...bySource.entries()]
      .filter(([src]) => channelGroup(src) === group)
      .map(([source, stats]) => ({ source, stats }))
      .sort((a, b) => b.stats.paidSum - a.stats.paidSum || b.stats.deals - a.stats.deals)
    if (!rows.length) continue
    const stats = emptyStats()
    for (const r of rows) for (const k of Object.keys(stats) as (keyof Stats)[]) stats[k] += r.stats[k]
    groups.push({ group, stats, rows })
  }
  return { groups, total, direct }
}

export type MonthCell = { deals: number; paid: number; paidSum: number }

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

export function buildMonthly(leads: ChannelLead[], zoneOf: ZoneOf, from: string, to: string) {
  const months = monthsBetween(from, to)
  const cells = new Map<string, MonthCell>()
  const key = (g: ChannelGroup | 'total', m: string) => `${g}|${m}`
  for (const lead of leads) {
    if (!inWindow(lead, from, to)) continue
    const m = moscowMonth(lead.created_at)
    const o = outcome(lead, zoneOf)
    for (const g of [channelGroup(leadSource(lead)), 'total'] as const) {
      const c = cells.get(key(g, m)) ?? { deals: 0, paid: 0, paidSum: 0 }
      c.deals++
      if (o.paid) { c.paid++; c.paidSum += Number(lead.price) || 0 }
      cells.set(key(g, m), c)
    }
  }
  const cell = (g: ChannelGroup | 'total', m: string): MonthCell => cells.get(key(g, m)) ?? { deals: 0, paid: 0, paidSum: 0 }
  return { months, cell }
}

// Сколько дней от создания сделки до «реализовано успешно» — чтобы видеть, какие месяцы
// ещё не успели дойти до оплаты.
export function daysToWin(leads: ChannelLead[]): { n: number; p25: number; median: number; p75: number } | null {
  const d = leads
    .filter(l => l.status_id === WON && l.closed_at && l.closed_at > l.created_at)
    .map(l => (Number(l.closed_at) - l.created_at) / 86400)
    .sort((a, b) => a - b)
  if (!d.length) return null
  const q = (p: number) => Math.round(d[Math.floor(p * (d.length - 1))])
  return { n: d.length, p25: q(0.25), median: q(0.5), p75: q(0.75) }
}

// Округление до целых с сохранением суммы (метод наибольшего остатка): строки в тысячах
// обязаны складываться в итог, который стоит под ними.
export function roundPreservingSum(values: number[], target: number): number[] {
  const floors = values.map(v => Math.floor(v))
  let rest = target - floors.reduce((s, v) => s + v, 0)
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  const out = [...floors]
  for (const { i } of order) {
    if (rest <= 0) break
    out[i]++
    rest--
  }
  return out
}

// Деньги в тысячах так, чтобы строки группы давали строку группы, а группы — итог.
export function thousandsTable(t: ChannelTable): { total: number; groups: number[]; rows: number[][] } {
  const total = Math.round(t.total.paidSum / 1000)
  const groups = roundPreservingSum(t.groups.map(g => g.stats.paidSum / 1000), total)
  const rows = t.groups.map((g, gi) => roundPreservingSum(g.rows.map(r => r.stats.paidSum / 1000), groups[gi]))
  return { total, groups, rows }
}
