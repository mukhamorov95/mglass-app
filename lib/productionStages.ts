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
  note?:             string
}

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
