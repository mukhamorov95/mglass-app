// Зоны воронки «Продажи» — один источник для /manager и lib/salesMonitor.ts.
// Таблица — копия SYSTEM.md («Воронка "Продажи" — зоны»); тест сверяет её с файлом.
// Новых зон и этапов здесь не придумывают: этап, которого нет в таблице, зоны не получает.

export type Zone = 1 | 2 | 3

export const SALES_ZONE_TABLE: ReadonlyArray<readonly [string, Zone]> = [
  ['Получена новая заявка', 1],
  ['Назначен ответственный', 1],
  ['Проработка', 1],
  ['Разговор состоялся', 1],
  ['Долгострой', 1],
  ['Готов купить', 1],
  ['Замер назначен', 2],
  ['Замер проведён', 2],
  ['Согласование после замера', 2],
  ['Чертежи в работу', 2],
  ['Согласование после отправки чертежей', 2],
  ['КП отправлено', 2],
  ['Счёт выставлен — ждём оплату', 2],
  ['Оплата сделана, чертежи не готовы', 3],
  ['Оплата получена, проверка чертежей', 3],
  ['Счёт оплачен', 3],
  ['Заказ в работе', 3],
  ['Готово к монтажу', 3],
  ['Монтаж назначен', 3],
  ['Монтаж начат / в процессе', 3],
  ['Рекламация', 3],
  ['Оплата остатка', 3],
  ['Оплата дизайнером', 3],
]

// Этапы AmoCRM, которые расходятся с таблицей словами, а не регистром, «ё» и знаками
// («…чертежа клиенту», «Монтаж начат и в процессе», «оплата дизайнерам»), зоны не получают —
// решение владельца 01.10.2026: показываются строкой «вне зон», пока этап не переименуют в amo.

export function normalizeStageName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s  -​ ⁠﻿]+/g, ' ')
    .replace(/[-‐-―−/,.:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ZONE_BY_STAGE = new Map<string, Zone>(SALES_ZONE_TABLE.map(([name, zone]) => [normalizeStageName(name), zone]))

// Точное совпадение после нормализации, а не «содержит слово»: раньше «замер» отправлял
// в зону 2 любой этап с этим словом, в том числе этапы других воронок и будущие этапы.
export function stageZone(name: string): Zone | null {
  return ZONE_BY_STAGE.get(normalizeStageName(name)) ?? null
}

type PipelineLike = { id: number; name: string; _embedded?: { statuses?: { id: number; name: string }[] } }

export function findSalesPipeline<P extends PipelineLike>(pipelines: P[]): P | undefined {
  const envId = process.env.AMOCRM_SALES_PIPELINE_ID ?? ''
  return pipelines.find(p => envId !== '' && String(p.id) === envId)
    ?? pipelines.find(p => normalizeStageName(p.name).includes('продаж'))
}

// id этапа → зона только внутри воронки «Продажи»: системные 142/143 и одноимённые
// этапы есть в каждой воронке («Разговор состоялся» — и в «Партнёрах»).
export function salesStageMap(pipeline: PipelineLike | undefined): Map<number, { name: string; zone: Zone | null }> {
  const map = new Map<number, { name: string; zone: Zone | null }>()
  for (const s of pipeline?._embedded?.statuses ?? []) map.set(s.id, { name: s.name, zone: stageZone(s.name) })
  return map
}

export type ZoneBreakdown = {
  sales: number
  zone1: number
  zone2: number
  zone3: number
  unzonedStages: { stage: string; count: number }[]
  otherPipelines: { pipeline: string; count: number }[]
}

// Разбор открытых сделок: sales = zone1 + zone2 + zone3 + сумма unzonedStages.
export function zoneBreakdown(
  openLeads: { status_id: number; pipeline_id: number }[],
  pipelines: PipelineLike[],
): ZoneBreakdown {
  const sales = findSalesPipeline(pipelines)
  const stages = salesStageMap(sales)
  const names = new Map(pipelines.map(p => [p.id, p.name]))
  const out: ZoneBreakdown = { sales: 0, zone1: 0, zone2: 0, zone3: 0, unzonedStages: [], otherPipelines: [] }
  const unzoned = new Map<string, number>()
  const other = new Map<string, number>()
  for (const l of openLeads) {
    if (!sales || l.pipeline_id !== sales.id) {
      const name = names.get(l.pipeline_id) ?? `воронка ${l.pipeline_id}`
      other.set(name, (other.get(name) ?? 0) + 1)
      continue
    }
    out.sales++
    const st = stages.get(l.status_id)
    if (st?.zone === 1) out.zone1++
    else if (st?.zone === 2) out.zone2++
    else if (st?.zone === 3) out.zone3++
    else {
      const name = st?.name ?? `этап ${l.status_id}`
      unzoned.set(name, (unzoned.get(name) ?? 0) + 1)
    }
  }
  const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])
  out.unzonedStages = sorted(unzoned).map(([stage, count]) => ({ stage, count }))
  out.otherPipelines = sorted(other).map(([pipeline, count]) => ({ pipeline, count }))
  return out
}
