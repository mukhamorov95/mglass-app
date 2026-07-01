import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// Отметка Валерии: чертежи по заказу распечатаны / нет. Хранится в notes.docs_printed.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const printed = !!body.printed

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: order } = await svc.from('b2b_orders').select('notes').eq('id', id).single()
  if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const notes = typeof order.notes === 'string'
    ? (() => { try { return JSON.parse(order.notes) } catch { return {} } })()
    : (order.notes ?? {})
  const nowIso = new Date().toISOString()
  notes.docs_printed = printed
  notes.docs_printed_at = printed ? nowIso : null
  notes.docs_printed_by = printed ? (user.email ?? user.id) : null
  // Зеркалим в order-level stages.printed — чтобы борд/список «Чертёж» видели отметку Валерии
  notes.stages = notes.stages ?? {}
  notes.stages.printed = printed ? nowIso : null

  const { error } = await svc.from('b2b_orders').update({ notes: JSON.stringify(notes) }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
