import { notifyAuthor } from '@/lib/partner/notifyAuthor'
import { NextRequest, NextResponse, after } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { reconcileClientOrders } from '@/lib/partnerNotify'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { previewWriteGuard } from '@/lib/partnerPreview'

// Колокольчик кабинета партнёра. GET — список своих уведомлений (+ опортунистическая
// сверка транзиций заказов, чтобы лента была свежей и без крона). POST — отметить
// прочитанным (свои). Строго по своему клиенту (b2b_clients.user_id = auth.uid()).

function svcClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = svcClient()
  const client = await resolvePartnerClient<{ id: number; name: string; user_id: string | null }>(svc, user.id, 'id,name,user_id')
  if (!client) return NextResponse.json({ linked: false, items: [], unread: 0 })

  // Сверка статусов — после ответа: последовательно по 100 заказам она держала ленту 4–15 с.
  // Новое событие появится при следующем открытии.
  after(() => reconcileClientOrders(svc, client as { id: number; name: string; user_id: string | null }).catch(() => {}))

  const { data } = await svc
    .from('partner_notifications')
    .select('id,kind,title,body,link,read_at,created_at,order_id')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const rows = (data ?? []) as { id: number; kind: string; order_id?: number | null; read_at: string | null }[]
  const orderIds = [...new Set(rows.map(n => n.order_id).filter((x): x is number => typeof x === 'number'))]
  const notesById = new Map<number, Record<string, unknown>>()
  let packs: { order_id: number; completed_at: string | null; completed_by_name: string | null; auto_closed_by_name: string | null }[] = []
  if (orderIds.length) {
    const [{ data: os }, { data: ps }] = await Promise.all([
      svc.from('b2b_orders').select('id, notes').in('id', orderIds).eq('client_id', client.id),
      svc.from('production_tasks').select('order_id, completed_at, completed_by_name, auto_closed_by_name')
        .in('order_id', orderIds).eq('stage_key', 'packaging').eq('status', 'done'),
    ])
    for (const o of os ?? []) { try { notesById.set(o.id as number, o.notes ? JSON.parse(o.notes as string) : {}) } catch { notesById.set(o.id as number, {}) } }
    packs = (ps ?? []) as typeof packs
  }
  const items = rows.map(n => ({
    ...n,
    by: n.order_id ? notifyAuthor(n.kind, notesById.get(n.order_id), packs.filter(p => p.order_id === n.order_id)) : null,
  }))
  const unread = items.filter(n => !n.read_at).length
  return NextResponse.json({ linked: true, items, unread })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = svcClient()
  const blocked = await previewWriteGuard(svc, user.id)
  if (blocked) return blocked
  const client = await resolvePartnerClient<{ id: number }>(svc, user.id)
  if (!client) return NextResponse.json({ error: 'Не привязан' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const now = new Date().toISOString()
  // Отметить одно (id) или все прочитанными — только в рамках своего client_id.
  let q = svc.from('partner_notifications').update({ read_at: now }).eq('client_id', client.id).is('read_at', null)
  if (body?.id) q = svc.from('partner_notifications').update({ read_at: now }).eq('client_id', client.id).eq('id', Number(body.id))
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
