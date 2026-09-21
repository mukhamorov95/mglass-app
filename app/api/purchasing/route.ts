import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser, getRole, isOwnerRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { mskDayKey } from '@/lib/time'
import { frontier, reconcileTotals, type SupplyState } from '@/lib/purchasing/supply'
import { loadOrders, computeNeeds, writeSupply } from '@/lib/purchasing/server'

export const dynamic = 'force-dynamic'

// Материал под заказы (docs/PURCHASING_ROUTE.md). Закупщик видит заказы B2B по
// порядку добавления, отмечает «не заказан / заказан / есть», а всё не
// заказанное складывается в раскрой — сколько листов какого материала заказать.
//
// Service-role: заказы и справочник читаются целиком, поэтому роль проверяем
// здесь, до первого запроса.

const ROLES = ['admin', 'ceo', 'buyer'] as const
const STATES: SupplyState[] = ['not_ordered', 'ordered', 'in_stock']
// Колонки канбана закупок, в которых материал ещё не пришёл (вместе со старыми
// значениями, которые канбан сам сводит к этим колонкам).
const OPEN_PO = ['invoice_received', 'sent_to_payment', 'paid_ready', 'pending_approval', 'waiting_payment', 'partially_paid', 'paid', 'in_transit']
const PO_LABEL: Record<string, string> = {
  invoice_received: 'Счёт получен', sent_to_payment: 'На оплате', paid_ready: 'Оплачен / к забору',
  pending_approval: 'Счёт получен', waiting_payment: 'На оплате', partially_paid: 'На оплате', paid: 'Оплачен / к забору', in_transit: 'В пути',
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...ROLES])
  if (guard instanceof NextResponse) return guard

  const withCut = new URL(req.url).searchParams.get('cut') === '1'
  const svc = createServiceClient()

  let all
  try { all = await loadOrders(svc) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }

  const userIds = [...new Set(all.map(o => o.updatedBy).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  if (userIds.length) {
    const { data: us } = await svc.from('users').select('id, name').in('id', userIds)
    for (const u of us ?? []) names.set(u.id as string, (u.name as string) ?? '')
  }

  const queue = all.filter(o => withCut || !o.cut)
  const toOrder = all.filter(o => !o.cut && o.state === 'not_ordered')
  const { needs, unknown, extraLayerM2, itemsM2, resolved } = await computeNeeds(svc, toOrder)

  // Заказы поставщикам, по которым материал ещё не пришёл, — с кнопкой «Пришёл».
  const numberOf = new Map(all.map(o => [o.id, o.number]))
  const { data: pos } = await svc.from('purchase_orders')
    .select('id, supplier_name, invoice_number, amount, status, created_at, expected_date, b2b_order_ids, items')
    .in('status', OPEN_PO).order('created_at', { ascending: false }).limit(100)
  const openPos = (pos ?? []).map(p => {
    const items = (Array.isArray(p.items) ? p.items : []) as { sheets_count?: number | null }[]
    const orderIds = ((p.b2b_order_ids ?? []) as number[]).map(Number)
    return {
      id: p.id as number,
      supplier: (p.supplier_name as string) || 'Не выбран',
      invoice: (p.invoice_number as string | null) ?? null,
      amount: p.amount == null ? null : Number(p.amount),
      status: PO_LABEL[p.status as string] ?? (p.status as string),
      createdAt: p.created_at as string,
      expected: (p.expected_date as string | null) ?? null,
      orders: orderIds.map(id => numberOf.get(id) ?? `№${id}`),
      orderIds,
      sheets: items.reduce((s, i) => s + (Number(i.sheets_count) || 0), 0),
    }
  })
  // У заказа — последний открытый заказ поставщику, в который он вошёл.
  const poOf = new Map<number, { id: number; supplier: string }>()
  for (const p of [...openPos].reverse()) for (const id of p.orderIds) poOf.set(id, { id: p.id, supplier: p.supplier })

  const { data: suppliers } = await svc.from('suppliers').select('id, name').eq('active', true).order('name')

  return NextResponse.json({
    queue: queue.map(o => ({
      id: o.id, number: o.number, client: o.client, createdAt: o.createdAt,
      state: o.state, materialStatus: o.materialStatus,
      updatedAt: o.updatedAt, updatedByName: o.updatedBy ? names.get(o.updatedBy) ?? null : null,
      cut: o.cut, pieces: o.pieces, netM2: o.netM2, materials: o.materials,
      po: poOf.get(o.id) ?? null,
    })),
    frontier: frontier(queue),
    counts: { active: all.filter(o => !o.cut).length, cut: all.filter(o => o.cut).length, toOrder: toOrder.length },
    needs,
    unknown,
    // Что распозналось из названия изделия — угадывание не прячем.
    resolved,
    totals: (() => {
      const rowsM2 = Math.round(needs.reduce((s, r) => s + r.netM2, 0) * 100) / 100
      const unknownM2 = Math.round(unknown.reduce((s, u) => s + u.m2, 0) * 100) / 100
      // Раскрытие итога: площадь позиций + вторые слои триплекса = строки + не распознанное.
      // Слои считаем остатком, иначе части не сходятся с суммой на сотую (см. reconcileTotals).
      const rec = reconcileTotals({ itemsM2, rowsM2, unknownM2 })
      return {
        sheets: needs.reduce((s, r) => s + r.sheets, 0),
        netM2: rowsM2,
        cost: needs.reduce((s, r) => s + r.cost, 0),
        unknownM2,
        itemsM2: rec.itemsM2,
        triplexM2: rec.triplexM2,
        totalM2: rec.totalM2,
        // Чистая сумма вторых слоёв — для проверки, что остаток не разъехался.
        triplexRawM2: extraLayerM2,
      }
    })(),
    toOrderIds: toOrder.map(o => o.id),
    supplierOrders: openPos.map(p => ({
      id: p.id, supplier: p.supplier, invoice: p.invoice, amount: p.amount, status: p.status,
      createdAt: p.createdAt, expected: p.expected, orders: p.orders, sheets: p.sheets,
    })),
    suppliers: (suppliers ?? []).map(s => ({ id: s.id as string, name: s.name as string })),
    // Карточка сделки показывает деньги и маржу — закупщику она закрыта,
    // поэтому ссылку на неё отдаём только владельцу.
    canOpenCard: isOwnerRole(await getRole()),
  })
}

// Отметка «не заказан / заказан / есть» — на один заказ или пачкой.
export async function POST(req: NextRequest) {
  const guard = await requireRole([...ROLES])
  if (guard instanceof NextResponse) return guard
  const user = await getSessionUser()

  const body = await req.json().catch(() => null) as { ids?: unknown; state?: unknown } | null
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(Number).filter(Number.isFinite))] : []
  const state = STATES.includes(body?.state as SupplyState) ? (body!.state as SupplyState) : null
  if (!ids.length || !state) return NextResponse.json({ error: 'Нужны ids и состояние' }, { status: 400 })
  if (ids.length > 300) return NextResponse.json({ error: 'Слишком много за раз' }, { status: 400 })

  const svc = createServiceClient()
  let orders
  try { orders = await loadOrders(svc, ids) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
  const res = await writeSupply(svc, orders, state, { today: mskDayKey(), userId: user?.id ?? null })
  return NextResponse.json({ ok: res.failed.length === 0, ...res })
}
