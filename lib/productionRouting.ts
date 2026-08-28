// Pure routing logic for production_tasks: derives the per-item stage route from
// item specification and builds the rows to insert when an order is launched.
// Separate from lib/productionStages.ts (the existing progress-over-JSON engine
// used by /p/o and /production-app) — this module targets the production_tasks
// table instead. No Supabase or React imports — pure logic only.

import { getApplicableStages, type DetailStageKey } from './productionStages'

export type RoutingStage = {
  stageKey:      Exclude<DetailStageKey, 'problem'>
  sequenceOrder: number
  station:       Exclude<DetailStageKey, 'problem'>  // 1:1 station === stage for now, no shared stations
}

// Reuses getApplicableStages (already handles tempering-for-mirrors and the
// hasHoles drilling filter) — does not reimplement those business rules.
export function buildItemRoute(
  item: { hasTempering?: boolean; materialName?: string; category?: string; hasHoles?: boolean; hasCutouts?: boolean; shape?: string; hasFacet?: boolean; hasTriplex?: boolean; hasSandblast?: boolean },
): RoutingStage[] {
  return getApplicableStages(item).map((stage, i) => ({
    stageKey:      stage.key,
    sequenceOrder: i + 1,
    station:       stage.key,
  }))
}

export type NewProductionTaskRow = {
  order_id:       number
  item_index:     number
  stage_key:      string
  sequence_order: number
  station:        string
  status:         'queued'
  production_day: string | null
  layer:          number        // 0 = изделие целиком; 1..N = слой пакета (обычные позиции — 1)
  layer_note:     string | null // подпись слоя для рабочего, напр. «слой 2: 4 мм»
}

export type RoutingItem = {
  hasTempering?: boolean; materialName?: string; category?: string
  hasHoles?: boolean; hasCutouts?: boolean; cutouts?: number; shape?: string; hasFacet?: boolean; hasSandblast?: boolean
  hasTriplex?: boolean; triplexLayers?: number; thickness?: number
  triplexGlasses?: { materialId?: number; materialName?: string; thickness?: number }[]
}

// Этапы, которые для триплекса выполняются НА КАЖДОМ СТЕКЛЕ пакета (до склейки).
const PER_LAYER_STAGES = new Set(['cutting', 'curved', 'polishing', 'drilling', 'facet', 'sandblast', 'tempering'])

export function buildProductionTasks(
  orderId: number,
  items: RoutingItem[],
): NewProductionTaskRow[] {
  const rows: NewProductionTaskRow[] = []
  items.forEach((item, itemIndex) => {
    const route = buildItemRoute(item)

    if (!item.hasTriplex) {
      route.forEach(stage => {
        rows.push({
          order_id: orderId, item_index: itemIndex,
          stage_key: stage.stageKey, sequence_order: stage.sequenceOrder, station: stage.station,
          status: 'queued', production_day: null, layer: 1, layer_note: null,
        })
      })
      return
    }

    // Триплекс: каждое стекло пакета — своя цепочка «резка→…→закалка» (layer 1..N),
    // затем склейка (triplex) и упаковка — на изделие целиком (layer 0).
    const layersCount = item.triplexLayers === 3 ? 3 : 2
    const glasses = Array.from({ length: layersCount }, (_, i) =>
      i === 0
        ? { materialName: item.materialName, thickness: item.thickness }
        : (item.triplexGlasses?.[i - 1] ?? { materialName: item.materialName, thickness: item.thickness }))

    const perLayer = route.filter(s => PER_LAYER_STAGES.has(s.stageKey))
    const perItem  = route.filter(s => !PER_LAYER_STAGES.has(s.stageKey))

    let seq = 0
    glasses.forEach((glass, gi) => {
      const note = `слой ${gi + 1}: ${glass.thickness ?? '?'} мм`
      perLayer.forEach(stage => {
        seq += 1
        rows.push({
          order_id: orderId, item_index: itemIndex,
          stage_key: stage.stageKey, sequence_order: seq, station: stage.station,
          status: 'queued', production_day: null, layer: gi + 1, layer_note: note,
        })
      })
    })
    perItem.forEach(stage => {
      seq += 1
      rows.push({
        order_id: orderId, item_index: itemIndex,
        stage_key: stage.stageKey, sequence_order: seq, station: stage.station,
        status: 'queued', production_day: null, layer: 0, layer_note: null,
      })
    })
  })
  return rows
}

// Andon reason codes — machine codes for production_tasks.problem_reason_code,
// separate from lib/productionStages.ts PROBLEM_REASONS (free Russian labels
// used by the existing /p/o UI). Keep in sync with the CHECK constraint in
// supabase/migrations/20260701_production_tasks.sql.
export const ANDON_REASONS: { code: string; label: string }[] = [
  { code: 'material_missing',   label: 'Нет материала' },
  { code: 'cut_defect',         label: 'Скол при резке' },
  { code: 'crack',              label: 'Трещина' },
  { code: 'scratch',            label: 'Царапина' },
  { code: 'wrong_size',         label: 'Неверный размер' },
  { code: 'material_defect',    label: 'Брак материала' },
  { code: 'tempering_defect',   label: 'Брак закалки' },
  { code: 'polishing_defect',   label: 'Брак полировки' },
  { code: 'drilling_defect',    label: 'Брак сверления' },
  { code: 'equipment_down',     label: 'Поломка оборудования' },
  { code: 'other',              label: 'Другое' },
]

export const ANDON_REASON_LABELS: Record<string, string> =
  Object.fromEntries(ANDON_REASONS.map(r => [r.code, r.label]))

// Старые экраны хранят причину РУССКОЙ СТРОКОЙ (PROBLEM_REASONS в
// productionStages), а БД принимает только коды из CHECK-констрейнта. Метки
// совпадают дословно, поэтому переводим; неизвестное → 'other', чтобы проблема
// дошла хоть как-то, а не отвалилась с 400 и не потерялась.
export function andonCode(reasonOrCode: string | null | undefined): string {
  const v = (reasonOrCode ?? '').trim()
  if (!v) return 'other'
  if (ANDON_REASONS.some(r => r.code === v)) return v
  const byLabel = ANDON_REASONS.find(r => r.label.toLowerCase() === v.toLowerCase())
  return byLabel?.code ?? 'other'
}
