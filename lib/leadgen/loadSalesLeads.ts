import 'server-only'
import { amoGet, getPipelines } from '@/lib/amocrm'
import { amoStageZone, type FunnelZone } from '@/lib/funnelZones'
import type { ChannelLead } from './channels'

// Сделки воронки «Продажи» из AmoCRM — только чтение (GET).
// Страница AmoCRM отвечает 2–5 секунд, поэтому страницы тянутся пачкой параллельно и
// кэшируются на час. Начало окна фиксированное, а порядок — по id: так адрес каждой
// страницы не меняется между запросами и кэш попадает.

export const CHANNELS_SINCE = '2025-01'
const SINCE_UNIX = String(Date.parse('2025-01-01T00:00:00+03:00') / 1000)
const PAGE = 250
const BATCH = 6
const CACHE_SEC = 3600

export async function loadSalesLeads(): Promise<{ leads: ChannelLead[]; zoneOf: (statusId: number) => FunnelZone | null }> {
  const pipelines = await getPipelines()
  const sales = pipelines.find(p => /продаж/i.test(p.name))
  if (!sales) throw new Error('Воронка «Продажи» не найдена в AmoCRM')

  const zones = new Map<number, FunnelZone | null>(sales._embedded.statuses.map(s => [s.id, amoStageZone(s.name)]))
  const params = {
    'filter[pipeline_id]': String(sales.id),
    'filter[created_at][from]': SINCE_UNIX,
    'order[id]': 'asc',
    limit: String(PAGE),
  }

  const byId = new Map<number, ChannelLead>()
  for (let first = 1; ; first += BATCH) {
    const pages = await Promise.all(
      Array.from({ length: BATCH }, (_, i) =>
        amoGet<{ _embedded?: { leads?: ChannelLead[] } }>('/leads', { ...params, page: String(first + i) }, CACHE_SEC)),
    )
    let last = false
    for (const d of pages) {
      const items = d?._embedded?.leads ?? []
      for (const l of items) byId.set(l.id, l)
      if (items.length < PAGE) last = true
    }
    if (last) break
  }

  return { leads: [...byId.values()], zoneOf: id => zones.get(id) ?? null }
}
