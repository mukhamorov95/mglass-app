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
  item: { hasTempering?: boolean; materialName?: string; category?: string; hasHoles?: boolean },
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
}

export function buildProductionTasks(
  orderId: number,
  items: { hasTempering?: boolean; materialName?: string; category?: string; hasHoles?: boolean }[],
): NewProductionTaskRow[] {
  const rows: NewProductionTaskRow[] = []
  items.forEach((item, itemIndex) => {
    buildItemRoute(item).forEach(stage => {
      rows.push({
        order_id:       orderId,
        item_index:     itemIndex,
        stage_key:      stage.stageKey,
        sequence_order: stage.sequenceOrder,
        station:        stage.station,
        status:         'queued',
        production_day: null,
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
