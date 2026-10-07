import type { SupabaseClient } from '@supabase/supabase-js'

// Решение партнёра по чертежу (notes.drawing_approval) никто не сбрасывает: менеджер или
// цех загружают новый файл поверх (order-drawings/<id>.<ext>, upsert), а решение остаётся.
// После «На доработку» новый чертёж было нельзя согласовать. Решение устарело, если файл
// чертежа загружен позже решения, — тогда кабинет снова спрашивает.

export type DrawingDecision = { status: 'approved' | 'rework'; comment: string | null; at: string | null }

// В notes лежит путь в бакете или старый publicUrl с ?t=… — как в /api/b2b/drawing.
export function drawingStoragePath(drawingUrl: string): string {
  const marker = '/b2b-attachments/'
  const noQuery = drawingUrl.split('?')[0]
  return noQuery.includes(marker) ? noQuery.slice(noQuery.indexOf(marker) + marker.length) : noQuery
}

export function decisionOf(raw: unknown): DrawingDecision | null {
  const d = raw as { status?: unknown; comment?: unknown; at?: unknown } | null | undefined
  if (!d || (d.status !== 'approved' && d.status !== 'rework')) return null
  return {
    status: d.status,
    comment: typeof d.comment === 'string' ? d.comment : null,
    at: typeof d.at === 'string' ? d.at : null,
  }
}

// Время файла неизвестно (не прочитали) — решение не трогаем: лучше прежний статус,
// чем снова спрашивать о том же чертеже.
export function isDecisionStale(decision: DrawingDecision | null, fileAt: string | null): boolean {
  if (!decision?.at || !fileAt) return false
  const d = Date.parse(decision.at)
  const f = Date.parse(fileAt)
  return Number.isFinite(d) && Number.isFinite(f) && f > d
}

const latest = (...xs: (string | null | undefined)[]): string | null => {
  let best: string | null = null
  for (const x of xs) if (x && !Number.isNaN(Date.parse(x)) && (!best || Date.parse(x) > Date.parse(best))) best = x
  return best
}

// Когда загружен файл чертежа: updated_at объекта (upsert его обновляет) или
// metadata.lastModified. null — файла нет или список не прочитался.
export async function drawingUploadedAt(svc: SupabaseClient, drawingUrl: string): Promise<string | null> {
  const path = drawingStoragePath(drawingUrl)
  const cut = path.lastIndexOf('/')
  const folder = cut >= 0 ? path.slice(0, cut) : ''
  const name = cut >= 0 ? path.slice(cut + 1) : path
  if (!name) return null
  const { data, error } = await svc.storage.from('b2b-attachments').list(folder, { search: name, limit: 100 })
  if (error) {
    console.error('[partner/drawing] список файлов не прочитан:', folder, error.message)
    return null
  }
  const obj = (data ?? []).find(f => f.name === name)
  if (!obj) return null
  return latest(obj.updated_at, obj.created_at, (obj.metadata as { lastModified?: string } | null)?.lastModified)
}
