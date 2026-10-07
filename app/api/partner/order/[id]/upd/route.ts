import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { loadUpdIssued } from '@/lib/b2b/updRegistry'

// УПД в кабинете — любому партнёру своего заказа, без флага самообслуживания: документ
// уже выдан бухгалтером, партнёр получает ту же бумагу. Отдаём только снимок, сохранённый
// при выдаче (строки и цены документа, реквизиты сторон — себестоимости в нём нет).
// Черновика из заказа здесь нет: его номер не совпал бы с настоящим документом.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const oid = Number(id)
  if (!oid) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const client = await resolvePartnerClient<{ id: number }>(svc, user.id)
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const { data: order, error: oErr } = await svc.from('b2b_orders')
    .select('id,client_id,custom_number').eq('id', oid).maybeSingle()
  if (oErr) return NextResponse.json({ error: `Заказ не прочитан: ${oErr.message}` }, { status: 500 })
  if (!order || order.client_id !== client.id) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  let updIssued
  try { updIssued = await loadUpdIssued(svc, oid) }
  catch (e) { return NextResponse.json({ error: `УПД не прочитан: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 }) }

  return NextResponse.json({
    order: { id: order.id as number, custom_number: (order.custom_number as string | null) ?? null },
    updIssued,
  })
}
