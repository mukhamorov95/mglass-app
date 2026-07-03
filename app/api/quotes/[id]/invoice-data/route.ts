import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isOwnerRole } from '@/lib/getRole'

// Данные для «Счёт-спецификации»: заказ + реквизиты покупателя (карточка клиента).
// Та же серверная проверка доступа, что и в kp-data.
async function loadOrderWithAccess(id: string) {
  const orderId = Number(id)
  if (!orderId) return { status: 400 as const, error: 'Invalid id' }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { status: 401 as const, error: 'Unauthorized' }

  const { data: order, error } = await sb
    .from('b2b_orders')
    .select('id,client_id,client_name,custom_number,client_order_number,discount_percent,items,total_area,total_weight,total_sale_inc_vat,total_after_discount,notes,created_at,created_by')
    .eq('id', orderId)
    .single()
  if (error || !order) return { status: 404 as const, error: 'Not found' }

  const { data: profile } = await sb.from('users').select('role,see_all_orders').eq('id', user.id).maybeSingle()
  const canAccess =
    isOwnerRole(profile?.role) ||
    (profile?.see_all_orders ?? false) ||
    order.created_by === user.id ||
    order.created_by === null ||
    (order.client_id != null &&
      (await sb.from('b2b_clients').select('id').eq('id', order.client_id).eq('user_id', user.id).maybeSingle()).data != null)
  if (!canAccess) return { status: 403 as const, error: 'Forbidden' }

  return { status: 200 as const, sb, order }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await loadOrderWithAccess(id)
  if (res.status !== 200) return NextResponse.json({ error: res.error }, { status: res.status })
  const { sb, order } = res

  let client = null
  if (order.client_id != null) {
    const { data } = await sb
      .from('b2b_clients')
      .select('id,name,full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date,contact,phone')
      .eq('id', order.client_id)
      .maybeSingle()
    client = data ?? null
  }

  return NextResponse.json({ order, client })
}

const REQUISITE_FIELDS = [
  'full_name', 'inn', 'kpp', 'ogrn', 'legal_address',
  'bank_account', 'bank_name', 'bik', 'corr_account',
  'supply_contract_no', 'supply_contract_date',
] as const

// Сохранение реквизитов покупателя в карточку клиента (по клиенту этого заказа).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await loadOrderWithAccess(id)
  if (res.status !== 200) return NextResponse.json({ error: res.error }, { status: res.status })
  const { sb, order } = res
  if (order.client_id == null) return NextResponse.json({ error: 'Заказ без клиента' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const f of REQUISITE_FIELDS) {
    if (f in body) {
      const v = body[f]
      patch[f] = (typeof v === 'string' && v.trim() === '') ? null : v
    }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, client_id: order.client_id })

  const svc = createServiceClient()
  const { error } = await svc.from('b2b_clients').update(patch).eq('id', order.client_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, client_id: order.client_id })
}
