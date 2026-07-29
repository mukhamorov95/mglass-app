import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'
import { recordPayment, voidPayment } from '@/lib/payments/recordPayment'
import { orderPaymentKey, type PaymentMethod } from '@/lib/payments/paymentKeys'
import { upsertSaleFromRetail, voidSale } from '@/lib/salesLedger'

// Оплата розничного заказа. Кроме статуса на самом заказе (legacy-колонки, их
// читают старые экраны) пишем факт денег в ядро: payments + продажа в crm_sales
// — иначе розничная оплата нигде не видна в Отделе продаж (незакрытый шаг Д2
// из docs/ERP_MONEY_ARCHITECTURE.md).
//
// Ключ канонизирован по документу (orderPaymentKey), поэтому отметка отсюда и
// та же отметка в ведомости продаж дают ОДНУ строку payments, а не дубль.

const METHODS: PaymentMethod[] = ['Счёт', 'Наличные', 'Карта', 'Перевод', 'Другое']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const guard = await requireRole(['admin', 'ceo', 'manager', 'buyer'])
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const body = await req.json()

  const status = String(body.payment_status ?? 'unpaid')
  const prepay = Number(body.prepayment_amount ?? 0) || 0
  const update: Record<string, unknown> = {
    payment_status:    status,
    prepayment_amount: prepay,
    prepayment_date:   body.prepayment_date   ?? null,
    payment_notes:     body.payment_notes?.trim() || null,
  }

  const client = createServiceClient()
  const { error } = await client.from('orders').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Деньги в учёт — best-effort: если ядро откажет, статус заказа всё равно
  // сохранён, а расхождение поймает ночная сверка.
  const warnings: string[] = []
  try {
    const { data: ord } = await client.from('orders')
      .select('id, client_name, total_sale_price, total_cost_price, created_by')
      .eq('id', id).maybeSingle()
    const order = ord as {
      id: string; client_name: string | null
      total_sale_price: number | null; total_cost_price: number | null
      created_by: string | null
    } | null
    if (!order) return NextResponse.json({ ok: true, warnings })

    const prepayKey = orderPaymentKey(order.id, 'prepayment')
    const restKey   = orderPaymentKey(order.id, 'settlement')

    if (status === 'unpaid') {
      await voidPayment(client, prepayKey, user.id)
      await voidPayment(client, restKey, user.id)
      await voidSale(client, { orderId: order.id })
      return NextResponse.json({ ok: true, warnings })
    }

    // Менеджер продажи — автор заказа, а не тот, кто нажал галочку.
    let manager: string | null = null
    if (order.created_by) {
      const { data: u } = await client.from('users').select('name').eq('id', order.created_by).maybeSingle()
      manager = (u as { name: string | null } | null)?.name ?? null
    }
    const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.prepayment_date ?? ''))
      ? String(body.prepayment_date) : new Date().toISOString().slice(0, 10)
    const method = METHODS.includes(body.payment_method as PaymentMethod)
      ? body.payment_method as PaymentMethod : 'Счёт'

    const saleId = await upsertSaleFromRetail(client, order, { paidAt, manager })
    const total = Number(order.total_sale_price ?? 0)

    if (status === 'partial' && prepay > 0) {
      await recordPayment(client, {
        externalKey: prepayKey, amount: prepay, paidAt, kind: 'prepayment',
        source: 'retail_order_payment', method,
        orderId: order.id, crmSaleId: saleId, enteredBy: user.id,
      })
      await voidPayment(client, restKey, user.id)   // остаток ещё не пришёл
    } else if (status === 'paid') {
      const rest = Math.round((total - prepay) * 100) / 100
      if (prepay > 0) {
        await recordPayment(client, {
          externalKey: prepayKey, amount: prepay, paidAt, kind: 'prepayment',
          source: 'retail_order_payment', method,
          orderId: order.id, crmSaleId: saleId, enteredBy: user.id,
        })
      }
      if (rest > 0) {
        await recordPayment(client, {
          externalKey: restKey, amount: rest, paidAt,
          kind: prepay > 0 ? 'remainder' : 'full',
          source: 'retail_order_payment', method,
          orderId: order.id, crmSaleId: saleId, enteredBy: user.id,
        })
      }
    }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Оплата сохранена, но не попала в учёт')
  }

  return NextResponse.json({ ok: true, warnings })
}
