import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase-server'

async function requireAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  const role = (data as { role: string } | null)?.role
  return role === 'admin' ? user : null
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { first_name, last_name, phone, telegram, email, notes, active } = body

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const update: Record<string, unknown> = {}
  if (first_name !== undefined) update.first_name = first_name
  if (last_name !== undefined) update.last_name = last_name
  if (phone !== undefined) update.phone = phone
  if (telegram !== undefined) update.telegram = telegram
  if (email !== undefined) update.email = email
  if (notes !== undefined) update.notes = notes
  if (active !== undefined) update.active = active

  const { data, error } = await supabase
    .from('role_assignments')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { error } = await supabase
    .from('role_assignments')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
