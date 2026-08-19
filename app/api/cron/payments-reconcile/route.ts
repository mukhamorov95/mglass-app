import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { recordPayment, voidPayment } from '@/lib/payments/recordPayment'
import { b2bPaymentKey } from '@/lib/payments/paymentKeys'
import { upsertSaleFromB2B, voidSale } from '@/lib/salesLedger'

export const maxDuration = 300

// Д2: ночная сверка notes ↔ денежное ядро. Первый прогон = бэкфилл всей
// истории оплат B2B (заказы, оплаченные до появления ядра). Идемпотентно:
// ключ платежа — бизнес-документ, повторный прогон ничего не меняет.
// Расхождение notes → ядро правится в пользу notes: пока notes остаются
// рабочим механизмом менеджеров, они и есть источник факта оплаты.

type Notes = {
  payment_status?: string
  prepayment_amount?: number
  stages?: Record<string, string | null>
}
const parseNotes = (raw: unknown): Notes => {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Notes
  try { return JSON.parse(String(raw)) as Notes } catch { return {} }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const svc = createServiceClient()
  type OrderRow = {
    id: number; custom_number: string | null; client_name: string | null
    total_after_discount: number | null; total_sale_inc_vat: number | null
    total_cost_net: number | null; total_cost_vat: number | null; items: unknown; created_by_name: string | null; notes: unknown; created_at: string
  }
  // Постранично: у Supabase дефолтный потолок 1000 строк, заказов больше.
  const orders: OrderRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await svc.from('b2b_orders')
      .select('id, custom_number, client_name, total_after_discount, total_sale_inc_vat, total_cost_net, total_cost_vat, items, created_by_name, notes, created_at')
      .order('id').range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const page = (data ?? []) as OrderRow[]
    orders.push(...page)
    if (page.length < PAGE) break
  }

  // Живые ключи ядра одним запросом: иначе на каждый неоплаченный заказ
  // уходил бы отдельный select и прогон не влезал в лимит времени.
  const liveKeys = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data } = await svc.from('payments').select('external_key').is('voided_at', null).range(from, from + PAGE - 1)
    const page = (data ?? []) as { external_key: string }[]
    page.forEach(p => liveKeys.add(p.external_key))
    if (page.length < PAGE) break
  }

  const stat = { scanned: orders.length, paid: 0, partial: 0, voided: 0, sales: 0, errors: [] as string[] }

  for (const o of orders) {
    const n = parseNotes(o.notes)
    const total = Number(o.total_after_discount ?? o.total_sale_inc_vat ?? 0)
    const isPaid = n.payment_status === 'paid' || !!n.stages?.invoice_paid
    const prepay = Number(n.prepayment_amount ?? 0)
    const paidAt = n.stages?.invoice_paid || String(o.created_at).slice(0, 10)
    const prepayKey = b2bPaymentKey(o.id, 'prepayment')
    const settleKey = b2bPaymentKey(o.id, 'settlement')

    try {
      if (isPaid && total > 0) {
        if (prepay > 0) {
          await recordPayment(svc, {
            externalKey: prepayKey, amount: prepay, paidAt, kind: 'prepayment',
            source: 'reconcile', b2bOrderId: o.id, importBatch: 'reconcile',
          })
        }
        const rest = Math.round((total - prepay) * 100) / 100
        if (rest > 0) {
          await recordPayment(svc, {
            externalKey: settleKey, amount: rest, paidAt, kind: prepay > 0 ? 'remainder' : 'full',
            source: 'reconcile', b2bOrderId: o.id, importBatch: 'reconcile',
          })
        }
        const saleId = await upsertSaleFromB2B(svc, o, { paidAt, manager: o.created_by_name })
        if (saleId) {
          await svc.from('crm_sales').update({
            // prepayment — NOT NULL (default 0): при полной оплате без предоплаты
            // пишем 0, а не null (иначе 23502 → 400, который глотал try/catch —
            // ~98 обновлений/ночь молча падали).
            prepayment: prepay || 0, prepayment_paid: prepay > 0,
            remainder_paid: true, paid_remainder_at: paidAt,
          }).eq('id', saleId)
          stat.sales++
        }
        stat.paid++
      } else if (n.payment_status === 'partial' && prepay > 0) {
        await recordPayment(svc, {
          externalKey: prepayKey, amount: prepay, paidAt, kind: 'prepayment',
          source: 'reconcile', b2bOrderId: o.id, importBatch: 'reconcile',
        })
        await voidPayment(svc, settleKey)
        const saleId = await upsertSaleFromB2B(svc, o, { paidAt, manager: o.created_by_name })
        if (saleId) {
          await svc.from('crm_sales').update({ prepayment: prepay, prepayment_paid: true, remainder_paid: false }).eq('id', saleId)
          stat.sales++
        }
        stat.partial++
      } else if (liveKeys.has(prepayKey) || liveKeys.has(settleKey)) {
        // Не оплачен, а в ядре платёж есть — оплату сняли задним числом.
        await voidPayment(svc, prepayKey)
        await voidPayment(svc, settleKey)
        await voidSale(svc, { b2bOrderId: o.id })
        stat.voided++
      }
    } catch (e) {
      if (stat.errors.length < 20) stat.errors.push(`#${o.id}: ${e instanceof Error ? e.message : 'ошибка'}`)
    }
  }

  const { count: liveCount } = await svc.from('payments')
    .select('*', { count: 'exact', head: true }).is('voided_at', null)

  return NextResponse.json({ ok: true, ...stat, corePayments: liveCount })
}
