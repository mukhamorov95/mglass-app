import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isOwnerRole } from '@/lib/getRole'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data: userRow } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!isOwnerRole((userRow as { role: string } | null)?.role)) {
    return NextResponse.json({ error: 'Только владелец' }, { status: 403 })
  }

  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 }) }

  const update: Record<string, unknown> = {}
  if (body.name           !== undefined) update.name           = String(body.name ?? '').trim()
  if (body.lead_name      !== undefined) update.lead_name      = body.lead_name  ? String(body.lead_name).trim()  || null : null
  if (body.phone          !== undefined) update.phone          = body.phone      ? String(body.phone).trim()      || null : null
  if (body.specialization !== undefined) update.specialization = Array.isArray(body.specialization) ? body.specialization : []
  if (body.active         !== undefined) update.active         = Boolean(body.active)
  if (body.notes          !== undefined) update.notes          = body.notes      ? String(body.notes).trim()      || null : null

  const { error } = await svc().from('brigades').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
