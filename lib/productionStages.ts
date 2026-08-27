// Shared types and pure helpers for production stage tracking.
// Used by /production-app/orders/[id] and /p/o/{id}.
// Do not import Supabase or React here — pure logic only.

export type DetailStageKey =
  | 'cutting'
  | 'curved'
  | 'polishing'
  | 'drilling'
  | 'facet'
  | 'sandblast'
  | 'tempering'
  | 'triplex'
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

// Порядок этапов = физика стекла: вся обработка кромки/отверстий/фацета ДО закалки
// (после закалки стекло не режут/сверлят), триплекс (склейка) — ПОСЛЕ закалки.
export const PRODUCTION_STAGES = [
  { key: 'cutting'   as const, label: 'Резка'        },
  { key: 'curved'    as const, label: 'Криволинейка' },
  { key: 'polishing' as const, label: 'Полировка'    },
  { key: 'drilling'  as const, label: 'Сверление'    },
  { key: 'facet'     as const, label: 'Фацет'        },
  { key: 'sandblast' as const, label: 'Песочка'      },
  { key: 'tempering' as const, label: 'Закалка'      },
  { key: 'triplex'   as const, label: 'Триплекс'     },
  { key: 'packaging' as const, label: 'Упаковка'     },
] satisfies { key: Exclude<DetailStageKey, 'problem'>; label: string }[]

// Ярлык этапа по строке ИЗ БАЗЫ. STAGE_LABELS сознательно оставлен строгим
// (Record<DetailStageKey, string>): он гарантирует, что у каждого этапа есть подпись,
// и ловит опечатки во всех 11 местах, где им пользуются. Ослабить его до
// Record<string, string> ради экранов, читающих stage_key из production_tasks, —
// значит снять эту гарантию везде ради удобства в одном месте. Поэтому граница
// «непроверенная строка → подпись» живёт здесь, одной функцией с фолбэком.
export function stageLabel(key: string): string {
  return STAGE_LABELS[key as DetailStageKey] ?? key
}

export const STAGE_LABELS: Record<DetailStageKey, string> = {
  cutting:   'Резка',
  curved:    'Криволинейка',
  polishing: 'Полировка',
  drilling:  'Сверление',
  facet:     'Фацет',
  sandblast: 'Песочка',
  tempering: 'Закалка',
  triplex:   'Триплекс',
  packaging: 'Упаковка',
  problem:   'Проблема',
}

// Returns applicable stages for an item.
// - tempering: только каленое и не зеркало.
// - drilling: `!== false` (старые записи без поля hasHoles сохраняют сверловку — без регрессии).
// - curved: только явно криволинейные изделия (shape === 'curved'); по умолчанию НЕ применяется.
// - facet: только если у детали есть фацет (hasFacet === true).
// - sandblast: песочка. Отдельная работа со своей оснасткой (макет → оракал → наклейка
//   → пескоструй), идёт ДО закалки: закалённое стекло не пескоструят.
// - triplex: только если деталь триплексная (hasTriplex === true).
export function getApplicableStages(
  item: { hasTempering?: boolean; materialName?: string; category?: string; hasHoles?: boolean; shape?: string; hasFacet?: boolean; hasTriplex?: boolean; hasSandblast?: boolean },
) {
  return PRODUCTION_STAGES.filter(s => {
    if (s.key === 'tempering') return itemNeedsTempering(item)
    if (s.key === 'drilling')  return item.hasHoles !== false
    if (s.key === 'curved')    return item.shape === 'curved'
    if (s.key === 'facet')     return item.hasFacet === true
    if (s.key === 'sandblast') return item.hasSandblast === true
    if (s.key === 'triplex')   return item.hasTriplex === true
    return true
  })
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
