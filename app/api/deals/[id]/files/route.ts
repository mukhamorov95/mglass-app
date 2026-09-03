import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor, canSeeDeal } from '@/lib/b2c/dealScope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Файлы сделки (чертёж и пр.). Загрузка сервис-клиентом в bucket kp-photos/deal/, ссылка
// в deal_files. Скоуп — как /api/deals: requireDealActor + canSeeDeal.
const MAX = 20 * 1024 * 1024
const OK = (t: string) => t.startsWith('image/') || t === 'application/pdf'

async function guard(id: string) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return { err: actor as NextResponse }
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return { err: NextResponse.json({ error: 'Некорректный id' }, { status: 400 }) }
  const svc = createServiceClient()
  const { data: deal } = await svc.from('deals').select('created_by, manager_id').eq('id', dealId).maybeSingle()
  if (!deal) return { err: NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 }) }
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return { err: NextResponse.json({ error: 'Нет доступа' }, { status: 403 }) }
  }
  return { actor, dealId, svc }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const { data } = await g.svc.from('deal_files')
    .select('id, kind, url, name, uploaded_by_name, created_at')
    .eq('deal_id', g.dealId).order('created_at', { ascending: false })
  return NextResponse.json({ files: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const kind = (form?.get('kind') as string) || 'drawing'
  if (!(file instanceof File)) return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })
  if (!OK(file.type)) return NextResponse.json({ error: 'Только изображение или PDF' }, { status: 415 })
  if (file.size > MAX) return NextResponse.json({ error: 'Файл больше 20 МБ' }, { status: 413 })

  const ext = (file.name.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'
  const path = `deal/${g.dealId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())
  const up = await g.svc.storage.from('kp-photos').upload(path, buf, { contentType: file.type, upsert: true })
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })
  const { data: pub } = g.svc.storage.from('kp-photos').getPublicUrl(path)

  const { data, error } = await g.svc.from('deal_files').insert({
    deal_id: g.dealId, kind, url: pub.publicUrl, name: file.name,
    uploaded_by: g.actor.userId, uploaded_by_name: g.actor.name,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id, url: pub.publicUrl })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const b = await req.json().catch(() => ({})) as { file_id?: number }
  if (!b.file_id) return NextResponse.json({ error: 'file_id обязателен' }, { status: 400 })
  const { error } = await g.svc.from('deal_files').delete().eq('id', b.file_id).eq('deal_id', g.dealId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
