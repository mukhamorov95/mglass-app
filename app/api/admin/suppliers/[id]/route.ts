import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isOwnerRole, normalizeRole } from '@/lib/getRole'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

const ALLOWED_WRITE = ['admin', 'ceo', 'buyer']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data: userRow } = await supabase.from('users').select('role').eq('id', user.id).single()
  const role = normalizeRole((userRow as { role: string } | null)?.role) ?? ''
  if (!ALLOWED_WRITE.includes(role)) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 }) }

  const str = (v: unknown) => (v != null && String(v).trim()) ? String(v).trim() : null

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name          !== undefined) update.name           = str(body.name)
  if (body.contact       !== undefined) update.contact        = str(body.contact)
  if (body.phone         !== undefined) update.phone          = str(body.phone)
  if (body.email         !== undefined) update.email          = str(body.email)
  if (body.whatsapp      !== undefined) update.whatsapp       = str(body.whatsapp)
  if (body.telegram      !== undefined) update.telegram       = str(body.telegram)
  if (body.address       !== undefined) update.address        = str(body.address)
  if (body.city          !== undefined) update.city           = str(body.city)
  if (body.work_hours    !== undefined) update.work_hours     = str(body.work_hours)
  if (body.materials     !== undefined) update.materials      = str(body.materials)
  if (body.type          !== undefined) update.type           = str(body.type)
  if (body.supplier_type !== undefined) update.supplier_type  = str(body.supplier_type)
  if (body.notes         !== undefined) update.notes          = str(body.notes)
  if (body.active        !== undefined) update.active         = Boolean(body.active)
  if (body.has_vat       !== undefined) update.has_vat        = Boolean(body.has_vat)
  if (body.status        !== undefined) update.status         = str(body.status)
  if (body.priority      !== undefined) update.priority       = Number(body.priority)
  if (body.lead_time_days !== undefined) update.lead_time_days = body.lead_time_days !== '' && body.lead_time_days != null ? Number(body.lead_time_days) : null

  const { data, error } = await svc().from('suppliers').update(update).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data: userRow } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!isOwnerRole((userRow as { role: string } | null)?.role)) {
    return NextResponse.json({ error: 'Только владелец может удалять' }, { status: 403 })
  }

  const { id } = await params
  const { error } = await svc().from('suppliers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
