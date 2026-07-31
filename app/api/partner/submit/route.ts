import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// Партнёр отправляет свой просчёт в заявку (на проверку менеджеру).
// Просчёт → status='pending_approval'. Только свой просчёт, только если не запущен.

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: client } = await svc.from('b2b_clients').select('id,name').eq('user_id', user.id).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const quoteId = Number(body?.quoteId)
  if (!quoteId) return NextResponse.json({ error: 'Не указан просчёт' }, { status: 400 })

  const { data: order } = await svc.from('b2b_orders')
    .select('id,client_id,launched_at,notes').eq('id', quoteId).maybeSingle()
  if (!order || order.client_id !== client.id) return NextResponse.json({ error: 'Просчёт не найден' }, { status: 404 })
  if (order.launched_at) return NextResponse.json({ error: 'Заказ уже в работе' }, { status: 400 })

  let notes: Record<string, unknown> = {}
  try { notes = order.notes ? JSON.parse(order.notes as string) : {} } catch {}
  if (notes.status === 'pending_approval') return NextResponse.json({ ok: true, already: true })

  const history = Array.isArray(notes.status_history) ? notes.status_history : []
  history.push({ from: (notes.status as string) || 'quote', to: 'pending_approval', date: new Date().toISOString(), by: 'partner' })
  notes.status = 'pending_approval'
  notes.status_history = history
  notes.submitted_by_partner_at = new Date().toISOString()

  const { error } = await svc.from('b2b_orders').update({ notes: JSON.stringify(notes), updated_at: new Date().toISOString() }).eq('id', quoteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
