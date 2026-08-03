import type { SupabaseClient } from '@supabase/supabase-js'

// Ведомость продаж наполняется САМА (docs/ERP_MONEY_ARCHITECTURE.md §3):
// факт оплаты — единственное событие, рождающее строку crm_sales.
// needs_review=true — «автосоздано, менеджер дозаполняет» (способ оплаты,
// партнёрские, дата готовности). Себестоимость — в crm_sale_finance
// (cost_overridden=true руками — авто-обновление не перетирает).
// Вызывается только с service-role из API-роутов (Д2) и крон-реконсилиатора.

type B2bOrderRow = {
  id: number
  custom_number: string | null
  client_name: string | null
  total_after_discount: number | null
  total_sale_inc_vat: number | null
  total_cost_net: number | null
  total_cost_vat?: number | null
  items?: unknown
}

// Себестоимость B2B-заказа С НДС — чтобы сходиться с amount (тоже с НДС), иначе
// маржа в реестре завышалась ~на 8-12 п.п. (net против inc-VAT). Считаем из
// позиций (costWithVat — материал+закалка+кромка+упаковка+доставка), как в
// /production-app/money; фолбэк на колонку total_cost_vat, затем net×1.22 (НДС 22%).
function b2bCostWithVat(order: B2bOrderRow): number {
  let items: Record<string, unknown>[] = []
  if (Array.isArray(order.items)) items = order.items as Record<string, unknown>[]
  else if (typeof order.items === 'string') { try { const p = JSON.parse(order.items); if (Array.isArray(p)) items = p } catch {} }
  const itemsCost = items.reduce((s, it) => s + (Number(it?.costWithVat) || 0), 0)
  if (itemsCost > 0) return itemsCost
  if (order.total_cost_vat != null) return Number(order.total_cost_vat)
  if (order.total_cost_net != null) return Number(order.total_cost_net) * 1.22
  return 0
}

type RetailOrderRow = {
  id: string
  client_name: string | null
  total_sale_price: number | null
  total_cost_price: number | null
}

async function upsertCost(svc: SupabaseClient, saleId: number, cost: number, source: 'b2b_order' | 'order' | 'calculation' | 'import') {
  const { data: existing } = await svc.from('crm_sale_finance').select('cost_overridden').eq('sale_id', saleId).maybeSingle()
  if ((existing as { cost_overridden?: boolean } | null)?.cost_overridden) return
  await svc.from('crm_sale_finance').upsert(
    { sale_id: saleId, cost: Math.round(cost * 100) / 100, cost_source: source, updated_at: new Date().toISOString() },
    { onConflict: 'sale_id' },
  )
}

export async function upsertSaleFromB2B(
  svc: SupabaseClient,
  order: B2bOrderRow,
  opts: { paidAt: string; manager?: string | null; actorName?: string | null },
): Promise<number | null> {
  const amount = Number(order.total_after_discount ?? order.total_sale_inc_vat ?? 0)
  const row = {
    b2b_order_id: order.id,
    sale_date: opts.paidAt,
    department: 'b2b',
    order_no: order.custom_number?.trim() || `00${order.id}`,
    client: order.client_name ?? '—',
    amount,
    manager: opts.manager ?? opts.actorName ?? null,
    source: 'auto_b2b_payment',
    needs_review: true,
    voided: false,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await svc.from('crm_sales')
    .upsert(row, { onConflict: 'b2b_order_id' })
    .select('id').single()
  if (error) throw new Error(`upsertSaleFromB2B(#${order.id}): ${error.message}`)
  const saleId = (data as { id: number }).id
  const costWithVat = b2bCostWithVat(order)
  if (costWithVat > 0) await upsertCost(svc, saleId, costWithVat, 'b2b_order')
  return saleId
}

export async function upsertSaleFromRetail(
  svc: SupabaseClient,
  order: RetailOrderRow,
  opts: { paidAt: string; manager?: string | null },
): Promise<number | null> {
  const row = {
    order_id: order.id,
    sale_date: opts.paidAt,
    department: 'mglass',
    order_no: order.id.slice(0, 8),
    client: order.client_name ?? '—',
    amount: Number(order.total_sale_price ?? 0),
    manager: opts.manager ?? null,
    source: 'auto_retail_payment',
    needs_review: true,
    voided: false,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await svc.from('crm_sales')
    .upsert(row, { onConflict: 'order_id' })
    .select('id').single()
  if (error) throw new Error(`upsertSaleFromRetail(${order.id}): ${error.message}`)
  const saleId = (data as { id: number }).id
  if (order.total_cost_price != null) await upsertCost(svc, saleId, Number(order.total_cost_price), 'order')
  return saleId
}

type ContractRow = {
  id: number
  number: string | null
  total: number | null
  customer: Record<string, unknown> | null
  manager_name: string | null
}

// Имя клиента у договора лежит в jsonb customer (физлицо — ФИО, юрлицо — название).
function contractClientName(customer: Record<string, unknown> | null): string {
  if (!customer) return '—'
  for (const k of ['name', 'fio', 'full_name', 'company', 'company_name', 'org', 'client']) {
    const v = customer[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return '—'
}

// Розница M-Glass: продажа рождается фактом ПЕРВОЙ оплаты по счёту (владелец
// выбрал этот момент — как уже работает для B2B). sale_date не переписывается
// последующими платежами: месяц продажи фиксируется первым поступлением.
export async function upsertSaleFromContract(
  svc: SupabaseClient,
  contract: ContractRow,
  opts: { paidAt: string; manager?: string | null; actorName?: string | null },
): Promise<number | null> {
  const { data: existing } = await svc.from('crm_sales')
    .select('id, sale_date').eq('contract_id', contract.id).maybeSingle()
  const prev = existing as { id: number; sale_date: string } | null

  const row = {
    contract_id: contract.id,
    sale_date: prev?.sale_date ?? opts.paidAt,
    department: 'mglass',
    order_no: contract.number?.trim() || `Д-${contract.id}`,
    client: contractClientName(contract.customer),
    amount: Number(contract.total ?? 0),
    manager: contract.manager_name ?? opts.manager ?? opts.actorName ?? null,
    source: 'auto_contract_payment',
    needs_review: true,
    voided: false,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await svc.from('crm_sales')
    .upsert(row, { onConflict: 'contract_id' })
    .select('id').single()
  if (error) throw new Error(`upsertSaleFromContract(#${contract.id}): ${error.message}`)
  return (data as { id: number }).id
}

// Откат оплаты: строка продажи не удаляется — помечается voided (история цела).
export async function voidSale(svc: SupabaseClient, link: { b2bOrderId?: number; orderId?: string }): Promise<void> {
  let q = svc.from('crm_sales').update({ voided: true, updated_at: new Date().toISOString() })
  if (link.b2bOrderId) q = q.eq('b2b_order_id', link.b2bOrderId)
  else if (link.orderId) q = q.eq('order_id', link.orderId)
  else return
  const { error } = await q
  if (error) throw new Error(`voidSale: ${error.message}`)
}
