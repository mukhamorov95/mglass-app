import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isOwnerRole } from '@/lib/getRole'

// Данные для «Счёт-спецификации»: заказ + юрлица покупателя (b2b_client_legal_entities).
// Одному клиенту можно завести несколько юрлиц; при счёте выбирается одно.
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

const ENTITY_COLS = 'id,client_id,full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date,is_default,active'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await loadOrderWithAccess(id)
  if (res.status !== 200) return NextResponse.json({ error: res.error }, { status: res.status })
  const { sb, order } = res

  let client = null
  let entities: unknown[] = []
  if (order.client_id != null) {
    const { data } = await sb
      .from('b2b_clients')
      .select('id,name,full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date,contact,phone')
      .eq('id', order.client_id)
      .maybeSingle()
    client = data ?? null
    const { data: ents } = await sb
      .from('b2b_client_legal_entities')
      .select(ENTITY_COLS)
      .eq('client_id', order.client_id)
      .eq('active', true)
      .order('is_default', { ascending: false })
      .order('id', { ascending: true })
    entities = ents ?? []
  }

  return NextResponse.json({ order, client, entities })
}

const REQUISITE_FIELDS = [
  'full_name', 'inn', 'kpp', 'ogrn', 'legal_address',
  'bank_account', 'bank_name', 'bik', 'corr_account',
  'supply_contract_no', 'supply_contract_date',
] as const

function pickRequisites(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const f of REQUISITE_FIELDS) {
    if (f in body) {
      const v = body[f]
      patch[f] = (typeof v === 'string' && v.trim() === '') ? null : v
    }
  }
  return patch
}

// Сохранение реквизитов покупателя. Новый путь — { entity: {...} }: добавляет
// (без id) или обновляет (с id) юрлицо клиента, НЕ затирая другие. Основное
// юрлицо зеркалится в плоские колонки b2b_clients (совместимость с пакетным счётом).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await loadOrderWithAccess(id)
  if (res.status !== 200) return NextResponse.json({ error: res.error }, { status: res.status })
  const { order } = res
  if (order.client_id == null) return NextResponse.json({ error: 'Заказ без клиента' }, { status: 400 })
  const clientId = order.client_id as number

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const svc = createServiceClient()

  if (body && typeof body.entity === 'object' && body.entity !== null) {
    const ent = body.entity as Record<string, unknown>
    const fields = pickRequisites(ent)
    const entId = Number(ent.id) || null

    const { data: c } = await svc.from('b2b_clients').select('organization_id').eq('id', clientId).maybeSingle()
    const org = (c?.organization_id as number | null) ?? 1

    let savedId: number | null = entId
    let isDefault = false
    if (entId) {
      const { data: cur } = await svc.from('b2b_client_legal_entities').select('is_default,client_id').eq('id', entId).maybeSingle()
      if (!cur || (cur.client_id as number) !== clientId) return NextResponse.json({ error: 'Юрлицо не найдено' }, { status: 404 })
      isDefault = !!cur.is_default
      const { error } = await svc.from('b2b_client_legal_entities').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', entId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { count } = await svc.from('b2b_client_legal_entities').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('active', true)
      isDefault = (count ?? 0) === 0
      const { data: ins, error } = await svc.from('b2b_client_legal_entities')
        .insert({ client_id: clientId, organization_id: org, ...fields, is_default: isDefault, active: true })
        .select('id').maybeSingle()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      savedId = (ins?.id as number | null) ?? null
    }
    if (isDefault) await svc.from('b2b_clients').update(fields).eq('id', clientId)
    return NextResponse.json({ ok: true, entity_id: savedId, is_default: isDefault })
  }

  // Легаси: плоское обновление карточки клиента (обратная совместимость).
  const patch = pickRequisites(body)
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, client_id: clientId })
  const { error } = await svc.from('b2b_clients').update(patch).eq('id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await svc.from('b2b_client_legal_entities').update(patch).eq('client_id', clientId).eq('is_default', true)
  return NextResponse.json({ ok: true, client_id: clientId })
}
