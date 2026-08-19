import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { isOwnerRole } from '@/lib/getRole'

// Данные для единого счёта на несколько B2B-заказов: сами заказы + справочник
// клиентов с реквизитами (для выбора плательщика). Плательщик ≠ заказчик:
// заказы идут на клиента, а счёт может выставляться на другое юрлицо.

const CLIENT_FIELDS = 'id,name,full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date,contact,phone'
const ORDER_FIELDS = 'id,client_id,client_name,payer_client_id,custom_number,client_order_number,discount_percent,items,total_area,total_weight,total_sale_inc_vat,total_after_discount,notes,created_at,created_by'

export async function GET(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const idsParam = new URL(req.url).searchParams.get('ids') ?? ''
  const ids = idsParam.split(',').map(s => Number(s.trim())).filter(n => n > 0)
  if (!ids.length) return NextResponse.json({ error: 'Не переданы заказы' }, { status: 400 })

  const { data: profile } = await sb.from('users').select('role,see_all_orders').eq('id', user.id).maybeSingle()
  const isOwner = isOwnerRole(profile?.role)
  const seeAll = isOwner || (profile?.see_all_orders ?? false)

  const { data: rows } = await sb.from('b2b_orders').select(ORDER_FIELDS).in('id', ids)
  const orders = (rows ?? []) as Record<string, unknown>[]

  // Доступ: владелец/see_all — всё; иначе только свои заказы или своего клиента.
  let visible = orders
  if (!seeAll) {
    const ownedClientIds = new Set(
      ((await sb.from('b2b_clients').select('id').eq('user_id', user.id)).data ?? []).map(c => c.id),
    )
    visible = orders.filter(o =>
      o.created_by === user.id || o.created_by == null ||
      (o.client_id != null && ownedClientIds.has(o.client_id as number)),
    )
  }
  if (!visible.length) return NextResponse.json({ error: 'Нет доступных заказов' }, { status: 403 })

  // Кандидаты в плательщики — клиенты с заполненными реквизитами (есть ИНН).
  const { data: payers } = await sb.from('b2b_clients').select(CLIENT_FIELDS)
    .not('inn', 'is', null).neq('inn', '').order('name')

  // Клиенты-заказчики выделенных заказов (на случай, если у них нет ИНН, но нужны в списке).
  const clientIds = [...new Set(visible.map(o => o.client_id).filter((x): x is number => x != null))]
  const { data: orderClients } = clientIds.length
    ? await sb.from('b2b_clients').select(CLIENT_FIELDS).in('id', clientIds)
    : { data: [] }

  // Юрлица кандидатов-плательщиков: выбор идёт на конкретное юрлицо (не просто клиента).
  const candidateClientIds = [...new Set([...(payers ?? []), ...(orderClients ?? [])].map(c => c.id as number))]
  const { data: entities } = candidateClientIds.length
    ? await sb.from('b2b_client_legal_entities')
        .select('id,client_id,full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date,is_default,active')
        .in('client_id', candidateClientIds).eq('active', true)
        .order('is_default', { ascending: false }).order('id', { ascending: true })
    : { data: [] }

  return NextResponse.json({
    orders: visible.sort((a, b) => Number(a.id) - Number(b.id)),
    payers: payers ?? [],
    orderClients: orderClients ?? [],
    entities: entities ?? [],
  })
}

// Запомнить плательщика в заказах (payer_client_id). Только владелец/see_all —
// это распорядительное действие. payerId = null снимает плательщика.
export async function PATCH(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await sb.from('users').select('role,see_all_orders').eq('id', user.id).maybeSingle()
  if (!isOwnerRole(profile?.role) && !(profile?.see_all_orders ?? false)) {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { ids?: number[]; payerId?: number | null }
  const ids = (body.ids ?? []).map(Number).filter(n => n > 0)
  if (!ids.length) return NextResponse.json({ error: 'Нет заказов' }, { status: 400 })
  const payerId = body.payerId == null ? null : Number(body.payerId)

  const { error } = await sb.from('b2b_orders').update({ payer_client_id: payerId }).in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, updated: ids.length })
}
