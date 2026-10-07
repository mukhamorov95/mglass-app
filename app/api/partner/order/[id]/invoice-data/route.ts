import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { documentSafeOrder } from '@/lib/b2b/publicQuote'
import { invoiceState, INVOICE_REFUSAL } from '@/lib/partner/documents'
import { loadInvoicedOrders } from '@/lib/partner/orderMoney'
import { isLaunched } from '@/lib/partner/orderProgress'

// Данные счёта-спецификации для кабинета партнёра. Строго по своему клиенту.
// Открывается, если владелец включил самообслуживание (b2b_clients.can_self_invoice) и
// заказ уже запущен (цифры финальные), иначе счёт выставляет менеджер. Точке на рынке
// (is_point) — до запуска, как только менеджер выставил счёт: она платит 100 % вперёд.
// Числа берём из сохранённого заказа b2b_orders — те же, что в нашем счёте (паритет).

const ENTITY_COLS = 'id,client_id,full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date,is_default,active'

function parseNotes(n: unknown): Record<string, unknown> {
  if (!n) return {}
  if (typeof n === 'object') return n as Record<string, unknown>
  try { const p = JSON.parse(String(n)); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const oid = Number(id)
  if (!oid) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const client = await resolvePartnerClient<{ id: number; name: string; can_self_invoice: boolean | null; is_point: boolean | null }>(
    svc, user.id, 'id,name,full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date,can_self_invoice,is_point')
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const { data: order } = await svc
    .from('b2b_orders')
    .select('id,client_id,client_name,custom_number,client_order_number,discount_percent,items,total_sale_inc_vat,total_after_discount,notes,created_at,launched_at')
    .eq('id', oid).maybeSingle()
  if (!order || order.client_id !== client.id) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const pn = parseNotes(order.notes)
  const isPoint = client.is_point === true
  let invoiced = false
  if (isPoint) {
    try { invoiced = (await loadInvoicedOrders(svc, [oid])).has(oid) }
    catch (e) { return NextResponse.json({ error: `Реестр счетов не прочитан: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 }) }
  }
  const state = invoiceState({ launched: isLaunched(order, pn), canSelfInvoice: !!client.can_self_invoice, isPoint, invoiced })
  if (state !== 'open') return NextResponse.json({ error: INVOICE_REFUSAL[state].error }, { status: INVOICE_REFUSAL[state].status })

  const c = client as unknown as Record<string, string | null>
  const { data: ents } = await svc
    .from('b2b_client_legal_entities')
    .select(ENTITY_COLS)
    .eq('client_id', client.id)
    .eq('active', true)
    .order('is_default', { ascending: false })
    .order('id', { ascending: true })

  // Наружу — только то, что печатается в счёте/УПД. Сырой items содержит costExVat,
  // costMaterial, margin и цены услуг: партнёру наша себестоимость не видна нигде,
  // включая JSON-ответ. Реквизиты клиента отдаём тоже белым списком.
  const safeClient = {
    id: client.id, name: client.name,
    full_name: c.full_name ?? null, inn: c.inn ?? null, kpp: c.kpp ?? null, ogrn: c.ogrn ?? null,
    legal_address: c.legal_address ?? null,
    bank_account: c.bank_account ?? null, bank_name: c.bank_name ?? null,
    bik: c.bik ?? null, corr_account: c.corr_account ?? null,
    supply_contract_no: c.supply_contract_no ?? null, supply_contract_date: c.supply_contract_date ?? null,
  }

  // documentSafeOrder теперь чистит и notes (белый список внутри хелпера) — здесь
  // ничего затирать не нужно: cost из items и внутренние поля notes вырезаны по
  // построению. УПД снова видит shipped_date/launched_at, счёт — quote_date/срок.
  const safeOrder = documentSafeOrder(order as Record<string, unknown>)

  // УПД — отдельный путь /api/partner/order/[id]/upd: он открыт любому партнёру заказа.
  return NextResponse.json({ order: safeOrder, client: safeClient, entities: ents ?? [] })
}
