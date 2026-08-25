import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerClient } from '@/lib/partnerClient'

// Данные счёта-спецификации для кабинета партнёра. Строго по своему клиенту.
// Открывается ТОЛЬКО если владелец включил самообслуживание (b2b_clients.can_self_invoice)
// И заказ уже запущен в производство (цифры финальные). Иначе счёт выставляет менеджер.
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
  const client = await resolvePartnerClient<{ id: number; name: string; can_self_invoice: boolean | null }>(
    svc, user.id, 'id,name,full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date,can_self_invoice')
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })
  if (!client.can_self_invoice) return NextResponse.json({ error: 'Счёт выставляет менеджер' }, { status: 403 })

  const { data: order } = await svc
    .from('b2b_orders')
    .select('id,client_id,client_name,custom_number,client_order_number,discount_percent,items,total_sale_inc_vat,total_after_discount,notes,created_at,launched_at')
    .eq('id', oid).maybeSingle()
  if (!order || order.client_id !== client.id) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  // Только запущенные в работу заказы (цифры финальные) — не черновики-просчёты.
  const pn = parseNotes(order.notes)
  const launched = !!(order.launched_at || pn.launched_at)
  if (!launched) return NextResponse.json({ error: 'Счёт доступен после запуска заказа в работу' }, { status: 409 })

  const { data: ents } = await svc
    .from('b2b_client_legal_entities')
    .select(ENTITY_COLS)
    .eq('client_id', client.id)
    .eq('active', true)
    .order('is_default', { ascending: false })
    .order('id', { ascending: true })

  // САНИТАЙЗ: наружу партнёру — только клиентское. Сырые items несут costExVat/
  // costWithVat/margin, а notes — внутренние поля (ai_review, история и т.п.).
  // Отдаём только то, что рисует счёт/УПД: цена продажи, габариты, обработка.
  const rawItems = Array.isArray(order.items) ? (order.items as Record<string, unknown>[]) : []
  const safeItems = rawItems.map(it => ({
    materialName: it.materialName as string | undefined,
    category: it.category as string | undefined,
    thickness: Number(it.thickness) || undefined,
    width: Number(it.width) || undefined,
    height: Number(it.height) || undefined,
    quantity: Number(it.quantity) || undefined,
    saleIncVat: Number(it.saleIncVat) || 0,
    hasTempering: !!it.hasTempering,
    hasFacet: !!it.hasFacet,
    facetTypeMm: it.facetTypeMm != null ? Number(it.facetTypeMm) : undefined,
    shape: it.shape as string | undefined,
    comment: it.comment as string | undefined,
    services: Array.isArray(it.services) ? (it.services as Record<string, unknown>[]).map(s => ({ id: Number(s.id) || 0, name: String(s.name ?? ''), cost: 0 })) : undefined,
    manualTotal: it.manualTotal != null ? Number(it.manualTotal) : null,
  }))
  const safeOrder = {
    id: order.id, custom_number: order.custom_number, client_name: order.client_name,
    client_order_number: order.client_order_number, discount_percent: Number(order.discount_percent) || 0,
    items: safeItems,
    total_sale_inc_vat: Number(order.total_sale_inc_vat) || 0,
    total_after_discount: Number(order.total_after_discount) || 0,
    notes: JSON.stringify({ quote_date: pn.quote_date ?? null, production_days: pn.production_days ?? null }),
    created_at: order.created_at,
  }

  return NextResponse.json({ order: safeOrder, client, entities: ents ?? [] })
}
