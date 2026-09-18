import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { mskDayKey } from '@/lib/time'
import { supplierOrderItems, splitForSupplierOrder } from '@/lib/purchasing/supply'
import { loadOrders, computeNeeds, writeSupply } from '@/lib/purchasing/server'

export const dynamic = 'force-dynamic'

// «Заказал» → заказ поставщику (З3, docs/PURCHASING_ROUTE.md). Одно действие
// делает две вещи, которые раньше расходились: заводит запись purchase_orders
// (её видит канбан закупок) и ставит заказам «заказан». Кнопка в «Заказах B2B»
// заводила только запись — поэтому три июльских заказа поставщику так и не
// связались со статусом материала.
//
// Позиции считаются здесь, тем же раскроем, что на экране: клиентскому списку
// не доверяем — в счёт должно попасть то, что закупщик видел, а не то, что пришло
// в теле запроса. Заявку поставщику система не отправляет.

const ROLES = ['admin', 'ceo', 'buyer'] as const
const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: NextRequest) {
  const guard = await requireRole([...ROLES])
  if (guard instanceof NextResponse) return guard
  const user = await getSessionUser()

  const b = await req.json().catch(() => null) as Record<string, unknown> | null
  const ids = Array.isArray(b?.orderIds) ? [...new Set((b!.orderIds as unknown[]).map(Number).filter(Number.isFinite))] : []
  const supplierName = String(b?.supplierName ?? '').trim().slice(0, 200)
  if (!ids.length) return NextResponse.json({ error: 'Не выбраны заказы' }, { status: 400 })
  if (ids.length > 300) return NextResponse.json({ error: 'Слишком много за раз' }, { status: 400 })
  if (!supplierName) return NextResponse.json({ error: 'Укажите поставщика' }, { status: 400 })

  const svc = createServiceClient()
  let orders
  try { orders = await loadOrders(svc, ids) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }

  // Уже заказанное и нарезанное повторно не заказываем — иначе попадёт в два счёта.
  const { take, skipped } = splitForSupplierOrder(orders)
  if (!take.length) return NextResponse.json({ error: 'На выбранные заказы материал уже заказан или есть', skipped }, { status: 409 })

  const { needs, unknown } = await computeNeeds(svc, take)
  const numberOf = new Map(take.map(o => [o.id, o.number]))
  const items = supplierOrderItems(needs, unknown, id => numberOf.get(id) ?? `№${id}`)
  const estimate = needs.reduce((s, r) => s + r.cost, 0)

  // «126 500,50» из поля ввода — пробелы и запятая; Number() дал бы NaN, и сумма
  // счёта молча подменилась бы оценкой.
  const amountRaw = String(b?.amount ?? '').replace(/\s/g, '').replace(',', '.')
  const amountIn = amountRaw === '' ? null : Number(amountRaw)
  if (amountIn != null && !(Number.isFinite(amountIn) && amountIn > 0)) {
    return NextResponse.json({ error: `Сумма «${String(b?.amount)}» не распознана` }, { status: 400 })
  }
  const amount = amountIn ?? estimate
  const expected = typeof b?.expectedDate === 'string' && DATE.test(b.expectedDate) ? b.expectedDate : null
  const invoice = String(b?.invoiceNumber ?? '').trim().slice(0, 100) || null
  const userComment = String(b?.comment ?? '').trim().slice(0, 1000)
  const comment = [
    'Заведено из «Материал под заказы»',
    amountIn == null ? `сумма — оценка по раскрою ${Math.round(estimate).toLocaleString('ru-RU')} ₽` : `оценка по раскрою ${Math.round(estimate).toLocaleString('ru-RU')} ₽`,
    unknown.length ? `не распознано в справочнике: ${unknown.map(u => u.material).join(', ')}` : '',
    userComment,
  ].filter(Boolean).join('. ')

  const { data: po, error } = await svc.from('purchase_orders').insert({
    supplier_name: supplierName,
    invoice_number: invoice,
    amount: Math.round(amount * 100) / 100,
    status: 'invoice_received',
    // Колонка текстовая; так же её пишут «Заказы B2B», канбан читает JSON-массив.
    order_refs: JSON.stringify(take.map(o => o.number)),
    b2b_order_ids: take.map(o => o.id),
    items,
    expected_date: expected,
    comment,
    created_by: user?.id ?? null,
  }).select('id').single()
  if (error || !po) return NextResponse.json({ error: error?.message ?? 'Не удалось завести заказ поставщику' }, { status: 500 })

  // Запись есть — только теперь отмечаем заказы. Если отметка по какому-то
  // заказу не прошла, заказ поставщику остаётся, а сбой возвращаем списком.
  const res = await writeSupply(svc, take, 'ordered', { today: mskDayKey(), userId: user?.id ?? null })
  return NextResponse.json({
    ok: res.failed.length === 0,
    purchaseOrderId: po.id,
    amount,
    estimate,
    marked: res.done,
    failed: res.failed,
    skipped,
  })
}
