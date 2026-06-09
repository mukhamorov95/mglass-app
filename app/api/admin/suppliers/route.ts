import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function requireAuth() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, role: null }
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  return { user, role: (data as { role: string } | null)?.role ?? null }
}

const ALLOWED_WRITE = ['admin', 'buyer']

const VALID_SUPPLIER_TYPES = ['glass_mirror','hardware','lighting','consumables','external_services','logistics','other']

export async function GET(req: NextRequest) {
  const { user } = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const supplierType = req.nextUrl.searchParams.get('supplier_type')
  const base = svc().from('suppliers').select('*').order('name')
  const { data, error } = await (
    supplierType && VALID_SUPPLIER_TYPES.includes(supplierType)
      ? base.eq('supplier_type', supplierType)
      : base
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { user, role } = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  if (!ALLOWED_WRITE.includes(role ?? '')) return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 }) }

  const { data, error } = await svc()
    .from('suppliers')
    .insert(sanitize(body))
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { user, role } = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  if (!ALLOWED_WRITE.includes(role ?? '')) return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 }) }

  const { id, ...fields } = body
  if (!id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 })

  const { data, error } = await svc()
    .from('suppliers')
    .update({ ...sanitize(fields), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { user, role } = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  if (role !== 'admin') return NextResponse.json({ error: 'Только администратор может удалять' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 })

  const { error } = await svc().from('suppliers').delete().eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

function sanitize(body: Record<string, unknown>) {
  return {
    name:            str(body.name),
    contact:         str(body.contact),
    phone:           str(body.phone),
    email:           str(body.email),
    whatsapp:        str(body.whatsapp),
    telegram:        str(body.telegram),
    address:         str(body.address),
    city:            str(body.city),
    work_hours:      str(body.work_hours),
    materials:       str(body.materials),
    type:            str(body.type),
    supplier_type:   str(body.supplier_type),
    notes:           str(body.notes),
    active:          body.active != null ? Boolean(body.active) : undefined,
    has_vat:         body.has_vat != null ? Boolean(body.has_vat) : undefined,
    status:          str(body.status),
    priority:        body.priority != null ? Number(body.priority) : undefined,
    lead_time_days:  body.lead_time_days != null && body.lead_time_days !== '' ? Number(body.lead_time_days) : null,
  }
}
