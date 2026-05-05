import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:            ['in_work', 'pending_approval', 'cancelled'],
  pending_approval: ['cancelled'],
  approved:         ['in_work', 'cancelled'],
  in_work:          ['completed', 'cancelled'],
  completed:        [],
  cancelled:        [],
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const isAdmin = userRow?.role === 'admin'
  const { id } = await params
  const { status: newStatus, notes } = await req.json()

  const client = isAdmin
    ? createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
    : supabase

  const { data: order, error: fetchErr } = await (isAdmin
    ? createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    : supabase
  ).from('orders').select('status').eq('id', id).single()

  if (fetchErr || !order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const allowed = VALID_TRANSITIONS[order.status] ?? []
  if (!allowed.includes(newStatus)) {
    return NextResponse.json(
      { error: `Переход из "${order.status}" в "${newStatus}" недопустим` },
      { status: 400 },
    )
  }

  const update: Record<string, unknown> = { status: newStatus }
  if (newStatus === 'in_work') update.launched_at = new Date().toISOString()
  if (newStatus === 'completed') update.actual_completion_date = new Date().toISOString()
  if (notes) update.notes = notes

  const { error } = await client.from('orders').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
