import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { reconcileClientOrders } from '@/lib/partnerNotify'
import { resolvePartnerClient } from '@/lib/partnerClient'

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

  // Свежая сверка статусов (best-effort, не роняет ленту).
  await reconcileClientOrders(svc, client as { id: number; name: string; user_id: string | null }).catch(() => {})

  const { data } = await svc
    .from('partner_notifications')
    .select('id,kind,title,body,link,read_at,created_at')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const items = data ?? []
  const unread = items.filter(n => !n.read_at).length
  return NextResponse.json({ linked: true, items, unread })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = svcClient()
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
