import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Модуль КП: создание (с автономером), список (история), обновление черновика.
const OWNER = new Set(['admin', 'ceo'])

async function authUser() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data: prof } = await sb.from('users').select('role, name').eq('id', user.id).maybeSingle()
  return { id: user.id, role: (prof?.role as string) ?? 'manager', name: (prof?.name as string) ?? user.email ?? '' }
}

// Числа: из content вытащить плоские поля для списка/поиска.
function flatFromContent(c: Record<string, unknown>) {
  const num = (v: unknown) => {
    if (v == null || v === '') return null
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
    return isFinite(n) ? n : null
  }
  return {
    client_name: (c.client_name as string) ?? null,
    title: (c.title as string) ?? null,
    total: num(c.total ?? c.total_pay),
    subtotal: num(c.subtotal),
    items: Array.isArray(c.items) ? c.items : [],
    valid_until: (c.valid_until_iso as string) ?? null,
  }
}

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: prof } = await sb.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = (prof?.role as string) ?? 'manager'
  // RLS сам ограничит выборку: менеджер — только свои, owner — все.
  const { data, error } = await sb
    .from('commercial_proposals')
    .select('id, number, client_name, total, status, manager_name, created_at, content')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [], role, canDelete: OWNER.has(role) })
}

export async function DELETE(req: Request) {
  const u = await authUser()
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!OWNER.has(u.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { id?: number }
  if (!body.id) return NextResponse.json({ error: 'no id' }, { status: 400 })
  const svc = createServiceClient()
  const { error } = await svc.from('commercial_proposals').delete().eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function POST(req: Request) {
  const u = await authUser()
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json() as { content?: Record<string, unknown> }
  const content = body.content ?? {}
  const svc = createServiceClient()

  const { data: numData, error: numErr } = await svc.rpc('next_cp_number')
  const number = (!numErr && typeof numData === 'string') ? numData : String(Date.now()).slice(-4) + '-0'
  const flat = flatFromContent(content)
  // номер в content — если менеджер не задал свой, ставим сгенерированный
  const finalContent = { ...content, number: (content.number as string) || number }

  const { data, error } = await svc.from('commercial_proposals').insert({
    number: (content.number as string) || number,
    client_name: flat.client_name,
    items: flat.items,
    subtotal: flat.subtotal,
    total: flat.total,
    valid_until: flat.valid_until,
    content: finalContent,
    photos: Array.isArray(content.photos) ? content.photos : [],
    manager_id: u.id,
    manager_name: u.name,
    status: 'draft',
  }).select('id, number').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id, number: data.number })
}

export async function PATCH(req: Request) {
  const u = await authUser()
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json() as { id?: number; content?: Record<string, unknown>; status?: string }
  if (!body.id) return NextResponse.json({ error: 'no id' }, { status: 400 })
  const svc = createServiceClient()

  const { data: row } = await svc.from('commercial_proposals').select('manager_id').eq('id', body.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (row.manager_id !== u.id && !OWNER.has(u.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.status) patch.status = body.status
  if (body.content) {
    const flat = flatFromContent(body.content)
    Object.assign(patch, {
      content: body.content,
      client_name: flat.client_name,
      items: flat.items, subtotal: flat.subtotal, total: flat.total,
      valid_until: flat.valid_until, number: (body.content.number as string) || undefined,
      photos: Array.isArray(body.content.photos) ? body.content.photos : undefined,
    })
  }
  const { error } = await svc.from('commercial_proposals').update(patch).eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
