import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { getRole } from '@/lib/getRole'
import { requireRole } from '@/lib/apiAuth'

// Карточка версии прайса: сама версия + её строки (снимок цен на дату).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params

  const supa = createServiceClient()
  const { data: list, error } = await supa.from('glass_price_lists').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!list) return NextResponse.json({ error: 'версия прайса не найдена' }, { status: 404 })

  const { data: items } = await supa
    .from('glass_price_list_items')
    .select('*')
    .eq('list_id', id)
    .order('sort_order')

  const { data: log } = await supa
    .from('glass_price_apply_log')
    .select('*')
    .eq('list_id', id)
    .order('applied_at', { ascending: false })

  return NextResponse.json({ list, items: items ?? [], log: log ?? [] })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { notes?: string; status?: string; title?: string; price_date?: string }

  const patch: Record<string, unknown> = {}
  if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 2000)
  if (typeof body.title === 'string') patch.title = body.title.slice(0, 300)
  if (body.price_date && /^\d{4}-\d{2}-\d{2}$/.test(body.price_date)) patch.price_date = body.price_date
  // статусом руками двигаем только в архив и обратно: 'applied' ставит применение прайса
  if (body.status === 'archived' || body.status === 'draft') patch.status = body.status
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'нечего менять' }, { status: 400 })

  const { error } = await createServiceClient().from('glass_price_lists').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Удалить можно только черновик, который ещё не применяли: применённые версии —
// это история себестоимости, они остаются навсегда.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const { id } = await params

  const supa = createServiceClient()
  const { data: list } = await supa.from('glass_price_lists').select('id, status, file_path').eq('id', id).maybeSingle()
  if (!list) return NextResponse.json({ error: 'версия прайса не найдена' }, { status: 404 })
  if (list.status === 'applied') return NextResponse.json({ error: 'применённый прайс удалить нельзя — это история цен' }, { status: 409 })

  const { count } = await supa.from('glass_price_apply_log').select('id', { count: 'exact', head: true }).eq('list_id', id)
  if ((count ?? 0) > 0) return NextResponse.json({ error: 'по этой версии уже менялись цены — удалять нельзя' }, { status: 409 })

  if (list.file_path) await supa.storage.from('b2b-attachments').remove([list.file_path])
  const { error } = await supa.from('glass_price_lists').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
