import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

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
  if ((userRow as { role: string } | null)?.role !== 'admin') {
    return NextResponse.json({ error: 'Только администратор' }, { status: 403 })
  }

  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 }) }

  const update: Record<string, unknown> = {}
  if (body.name        !== undefined) update.name        = String(body.name ?? '').trim()
  if (body.description !== undefined) update.description = body.description ? String(body.description).trim() || null : null
  if (body.price       !== undefined) update.price       = Number(body.price) || 0
  if (body.sort_order  !== undefined) update.sort_order  = Number(body.sort_order) || 0
  if (body.active      !== undefined) update.active      = Boolean(body.active)

  const { error } = await svc().from('delivery_zones').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
