import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Договоры + Счета. Изоляция как у КП: менеджер только свои, удаляет admin/ceo.
const OWNER = new Set(['admin', 'ceo'])

async function authUser() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data: prof } = await sb.from('users').select('role, name').eq('id', user.id).maybeSingle()
  return { id: user.id, role: (prof?.role as string) ?? 'manager', name: (prof?.name as string) ?? user.email ?? '' }
}

const num = (v: unknown) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  return isFinite(n) ? n : null
}

type CBody = {
  id?: number
  content?: Record<string, unknown>
  status?: string
}

function flat(c: Record<string, unknown>) {
  return {
    kp_id: c.kp_id ? Number(c.kp_id) : null,
    customer_type: (c.customer_type as string) ?? 'individual',
    customer: (c.customer as Record<string, unknown>) ?? {},
    spec: Array.isArray(c.spec) ? c.spec : [],
    total: num(c.total),
    make_sum: num(c.make_sum),
    install_sum: num(c.install_sum),
    product_kind: (c.product_kind as string) ?? 'mirror',
    make_days: c.make_days != null ? Number(c.make_days) : 15,
    install_days: c.install_days != null ? Number(c.install_days) : 5,
    valid_until: null as string | null,
  }
}

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: prof } = await sb.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = (prof?.role as string) ?? 'manager'
  const { data, error } = await sb
    .from('contracts')
    .select('id, number, kp_id, customer_type, total, status, manager_name, created_at, content')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [], role, canDelete: OWNER.has(role) })
}

export async function POST(req: Request) {
  const u = await authUser()
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json() as CBody
  const content = body.content ?? {}
  const svc = createServiceClient()

  const { data: numData, error: numErr } = await svc.rpc('next_contract_number')
  const number = (!numErr && typeof numData === 'string') ? numData : String(Date.now()).slice(-4) + '-0'
  const f = flat(content)
  const finalContent = { ...content, number: (content.number as string) || number }

  const { data, error } = await svc.from('contracts').insert({
    number: (content.number as string) || number,
    kp_id: f.kp_id,
    date: (content.date_iso as string) || null,
    customer_type: f.customer_type,
    customer: f.customer,
    spec: f.spec,
    total: f.total,
    make_sum: f.make_sum,
    install_sum: f.install_sum,
    product_kind: f.product_kind,
    make_days: f.make_days,
    install_days: f.install_days,
    content: finalContent,
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
  const body = await req.json() as CBody
  if (!body.id) return NextResponse.json({ error: 'no id' }, { status: 400 })
  const svc = createServiceClient()

  const { data: row } = await svc.from('contracts').select('manager_id').eq('id', body.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (row.manager_id !== u.id && !OWNER.has(u.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.status) patch.status = body.status
  if (body.content) {
    const f = flat(body.content)
    Object.assign(patch, {
      content: body.content, kp_id: f.kp_id, customer_type: f.customer_type, customer: f.customer,
      spec: f.spec, total: f.total, make_sum: f.make_sum, install_sum: f.install_sum,
      product_kind: f.product_kind, make_days: f.make_days, install_days: f.install_days,
      number: (body.content.number as string) || undefined,
      date: (body.content.date_iso as string) || undefined,
    })
  }
  const { error } = await svc.from('contracts').update(patch).eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const u = await authUser()
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!OWNER.has(u.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { id?: number }
  if (!body.id) return NextResponse.json({ error: 'no id' }, { status: 400 })
  const svc = createServiceClient()
  const { error } = await svc.from('contracts').delete().eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
