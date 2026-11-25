import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { denyUnless, resolvePartnerMember } from '@/lib/partnerClient'
import { documentSafeOrder } from '@/lib/b2b/publicQuote'
import { invoiceBasis, mergeInvoiceOrders, type InvoiceOrder } from '@/lib/b2b/invoiceMath'
import { partnerOrderNo } from '@/lib/partner/format'

// Документ объединённого счёта для кабинета: строки всех заказов счёта, номер и дата — из реестра.
// Числа — из сохранённых заказов (как у счёта одного заказа), себестоимость наружу не уходит.

const REQ = 'full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = createServiceClient()
  const pm = await resolvePartnerMember<Record<string, unknown> & { id: number; name: string }>(svc, user.id, `id,name,${REQ}`)
  if (!pm) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })
  { const denied = denyUnless(pm.role, 'finance'); if (denied) return denied }
  const client = pm.client

  const { data: inv } = await svc.from('invoices').select('id, invoice_no, order_ids, payer_client_id, payer_entity_id, status, issued_at').eq('id', id).maybeSingle()
  if (!inv || inv.payer_client_id !== client.id || inv.status === 'cancelled') return NextResponse.json({ error: 'Счёт не найден' }, { status: 404 })
  const ids = ((inv.order_ids ?? []) as number[]).map(Number)
  const { data: rows, error } = await svc.from('b2b_orders')
    .select('id,client_id,client_name,custom_number,client_order_number,discount_percent,items,total_sale_inc_vat,total_after_discount,notes,created_at,launched_at')
    .in('id', ids).order('id')
  if (error) return NextResponse.json({ error: `Заказы счёта не прочитаны: ${error.message}` }, { status: 500 })
  if ((rows ?? []).length !== ids.length || rows!.some(o => o.client_id !== client.id)) return NextResponse.json({ error: 'Счёт не найден' }, { status: 404 })

  const orders = rows!.map(o => ({ ...(documentSafeOrder(o as Record<string, unknown>) as unknown as InvoiceOrder), no: partnerOrderNo({ id: o.id as number, custom_number: o.custom_number as string | null }), theirNo: ((o.client_order_number as string | null) ?? '').trim() || null }))
  const order = mergeInvoiceOrders(orders, { id: inv.id as number, invoiceNo: String(inv.invoice_no), issuedAt: String(inv.issued_at) })

  const { data: ents } = await svc.from('b2b_client_legal_entities').select(`id,client_id,${REQ},is_default,active`)
    .eq('client_id', client.id).eq('active', true).order('is_default', { ascending: false }).order('id')
  const safeClient: Record<string, unknown> = { id: client.id, name: client.name }
  for (const k of REQ.split(',')) safeClient[k] = client[k] ?? null
  return NextResponse.json({
    order, client: safeClient, entities: ents ?? [], payerEntityId: inv.payer_entity_id ?? null,
    orders: orders.map(o => ({ id: o.id, no: o.no })),
    basis: invoiceBasis(orders),
  })
}
