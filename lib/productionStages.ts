// Shared types and pure helpers for production stage tracking.
// Used by /production-app/orders/[id] and /p/o/{id}.
// Do not import Supabase or React here — pure logic only.

export type DetailStageKey =
  | 'cutting'
  | 'polishing'
  | 'drilling'
  | 'tempering'
  | 'packaging'
  | 'problem'

export type DetailStageState = {
  status:            'done' | 'problem'
  updated_at:        string
  updated_by:        string
  updated_by_email?: string
  reason?:           string
  note?:             string
}

export const PROBLEM_REASONS = [
  'Скол при резке',
  'Трещина',
  'Царапина',
  'Неверный размер',
  'Брак материала',
  'Брак закалки',
  'Брак полировки',
  'Брак сверления',
  'Другое',
] as const

export type ProblemReason = typeof PROBLEM_REASONS[number]

export type DetailStages = {
  [itemIndex: string]: { [stage in DetailStageKey]?: DetailStageState }
}

export const MIRROR_RE = /зеркало|mirror|silver|серебро|сильвер/i

export function isMirrorItem(item: { materialName?: string; category?: string }): boolean {
  return MIRROR_RE.test(`${item.materialName ?? ''} ${item.category ?? ''}`)
}

export function itemNeedsTempering(item: { hasTempering?: boolean; materialName?: string; category?: string }): boolean {
  return item.hasTempering === true && !isMirrorItem(item)
}

// ─── Stage definitions (single source of truth, no UI icons) ──────────────────

export const PRODUCTION_STAGES = [
  { key: 'cutting'   as const, label: 'Резка'     },
  { key: 'polishing' as const, label: 'Полировка' },
  { key: 'drilling'  as const, label: 'Сверление' },
  { key: 'tempering' as const, label: 'Закалка'   },
  { key: 'packaging' as const, label: 'Упаковка'  },
] satisfies { key: Exclude<DetailStageKey, 'problem'>; label: string }[]

export const STAGE_LABELS: Record<DetailStageKey, string> = {
  cutting:   'Резка',
  polishing: 'Полировка',
  drilling:  'Сверление',
  tempering: 'Закалка',
  packaging: 'Упаковка',
  problem:   'Проблема',
}

// Returns applicable stages for an item (filters out tempering when not needed)
export function getApplicableStages(
  item: { hasTempering?: boolean; materialName?: string; category?: string },
) {
  return PRODUCTION_STAGES.filter(s => s.key !== 'tempering' || itemNeedsTempering(item))
}

// ─── Progress types and helpers ───────────────────────────────────────────────
// NOTE: progress tracks item *rows*, not physical pieces.
// quantity > 1 = multiple pieces in one row (future: b2b_order_details table).

export type ItemProgress = {
  itemIndex:     number
  totalStages:   number
  doneStages:    number
  completedKeys: Exclude<DetailStageKey, 'problem'>[]
  packagingDone: boolean   // packaging done — used as final-stage proxy in list views
  hasProblem:    boolean
  isComplete:    boolean   // all applicable stages done
}

export type OrderProgress = {
  items:          ItemProgress[]
  totalItems:     number
  completedItems: number   // all applicable stages done
  packedItems:    number   // packaging done (list-view counter)
  progressPct:    number   // based on completedItems
  hasProblems:    boolean
}

export function calcItemProgress(
  item: { hasTempering?: boolean; materialName?: string; category?: string },
  itemIndex: number,
  detailStages: DetailStages,
): ItemProgress {
  const stages        = getApplicableStages(item)
  const s             = detailStages[String(itemIndex)] ?? {}
  const totalStages   = stages.length
  const completedKeys = stages
    .filter(st => s[st.key]?.status === 'done')
    .map(st => st.key)
  const doneStages    = completedKeys.length
  const packagingDone = s.packaging?.status === 'done'
  const hasProblem    = s.problem?.status === 'problem'
  return {
    itemIndex,
    totalStages,
    doneStages,
    completedKeys,
    packagingDone,
    hasProblem,
    isComplete: doneStages === totalStages,
  }
}

export function calcOrderProgress(
  items: { hasTempering?: boolean; materialName?: string; category?: string }[],
  detailStages: DetailStages,
): OrderProgress {
  const itemList       = items.map((item, i) => calcItemProgress(item, i, detailStages))
  const totalItems     = items.length
  const completedItems = itemList.filter(p => p.isComplete).length
  const packedItems    = itemList.filter(p => p.packagingDone).length
  const hasProblems    = itemList.some(p => p.hasProblem)
  const progressPct    = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0
  return { items: itemList, totalItems, completedItems, packedItems, progressPct, hasProblems }
}
