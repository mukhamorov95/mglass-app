import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { denyAction } from '@/lib/measure/access'
import { requireMeasureActor } from '@/lib/measure/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Файл замера (чертёж/фото) к заявке. Пишем сервисным клиентом в публичный bucket
// kp-photos (префикс measure/) — у него уже есть storage-политики, прямая заливка из
// браузера упёрлась бы в RLS. Ссылку дописываем в measure_requests.photos.
// Прикладывает замерщик этого замера, менеджер заявки, офис или владелец (denyAction).
const MAX = 15 * 1024 * 1024
const OK = (t: string) => t.startsWith('image/') || t === 'application/pdf'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireMeasureActor()
  if (actor instanceof NextResponse) return actor
  const { id } = await params
  const reqId = Number(id)
  if (!Number.isFinite(reqId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const svc = createServiceClient()
  const { data: row, error: readErr } = await svc.from('measure_requests')
    .select('id, status, manager_id, measurer_id, photos').eq('id', reqId).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  const deny = denyAction(actor, row as { id: number; status: string; manager_id: string | null; measurer_id: string | null }, 'attach')
  if (deny) return NextResponse.json({ error: deny }, { status: 403 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })
  if (!OK(file.type)) return NextResponse.json({ error: 'Только изображение или PDF' }, { status: 415 })
  if (file.size > MAX) return NextResponse.json({ error: 'Файл больше 15 МБ' }, { status: 413 })

  const ext = (file.name.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'
  const path = `measure/${reqId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  const up = await svc.storage.from('kp-photos').upload(path, buf, { contentType: file.type, upsert: true })
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })
  const { data: pub } = svc.storage.from('kp-photos').getPublicUrl(path)

  const photos = Array.isArray(row.photos) ? (row.photos as string[]) : []
  const { error: updErr } = await svc.from('measure_requests').update({ photos: [...photos, pub.publicUrl] }).eq('id', reqId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ url: pub.publicUrl })
}
