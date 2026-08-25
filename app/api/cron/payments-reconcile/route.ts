import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { recordPayment, voidPayment } from '@/lib/payments/recordPayment'
import { b2bPaymentKey, salePaymentKey } from '@/lib/payments/paymentKeys'
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

  const stat = { scanned: orders.length, paid: 0, partial: 0, voided: 0, sales: 0, retail: 0, errors: [] as string[] }

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

  // Б7: розница в ядро. Оплаты B2C живут галочками ведомости продаж, а не
  // заказами: в orders одна строка на всю базу.
  // ВНИМАНИЕ: 925 из 926 розничных строк — историческая выгрузка из Google-
  // таблицы (import_gsheet, 2024–2026, ~140 млн ₽), и CFO-сессия отметила её как
  // недоверенный источник факта. Поэтому массовый бэкфилл истории в денежное
  // ядро НЕ идёт в плановом ночном прогоне: он запускается только явно
  // (?retail=1), чтобы владелец/backbone запустили его осознанно и сверили
  // результат, а не обнаружили 140 млн в ядре наутро. Строки помечаются
  // import_batch='reconcile' и source='reconcile_retail' — заливка обратима (void).
  const doRetail = new URL(req.url).searchParams.get('retail') === '1'
  if (!doRetail) {
    const { count: liveOnly } = await svc.from('payments')
      .select('*', { count: 'exact', head: true }).is('voided_at', null)
    return NextResponse.json({ ok: true, ...stat, retail: 'skipped (add ?retail=1 to backfill)', corePayments: liveOnly })
  }
  type SaleRow = {
    id: number; amount: number | null; prepayment: number | null; sale_date: string
    paid_remainder_at: string | null; prepayment_paid: boolean; remainder_paid: boolean
    payment_method: string | null; b2b_order_id: number | null; order_id: string | null
    manager: string | null; voided: boolean
  }
  const sales: SaleRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data } = await svc.from('crm_sales')
      .select('id, amount, prepayment, sale_date, paid_remainder_at, prepayment_paid, remainder_paid, payment_method, b2b_order_id, order_id, manager, voided')
      .is('b2b_order_id', null).order('id').range(from, from + PAGE - 1)
    const page = (data ?? []) as SaleRow[]
    sales.push(...page)
    if (page.length < PAGE) break
  }

  const METHODS = ['Счёт', 'Наличные', 'Карта', 'Перевод', 'Другое'] as const
  const isDate = (d: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ''))

  for (const s of sales) {
    const link = { id: s.id, b2b_order_id: s.b2b_order_id, order_id: s.order_id }
    const prepayKey = salePaymentKey(link, 'prepayment')
    const restKey = salePaymentKey(link, 'remainder')
    const total = Number(s.amount ?? 0)
    const prepay = Number(s.prepayment ?? 0)
    const rest = Math.round((total - prepay) * 100) / 100
    const method = (METHODS as readonly string[]).includes(s.payment_method ?? '')
      ? s.payment_method as typeof METHODS[number] : 'Счёт'
    const saleDate = isDate(s.sale_date) ? s.sale_date : null
    if (!saleDate) continue

    try {
      if (!s.voided && s.prepayment_paid && prepay > 0) {
        await recordPayment(svc, {
          externalKey: prepayKey, amount: prepay, paidAt: saleDate, kind: 'prepayment',
          source: 'reconcile_retail', method, crmSaleId: s.id, orderId: s.order_id,
          enteredByName: s.manager, importBatch: 'reconcile',
        })
        stat.retail++
      } else if (liveKeys.has(prepayKey)) {
        await voidPayment(svc, prepayKey)
      }

      if (!s.voided && s.remainder_paid && rest > 0) {
        await recordPayment(svc, {
          externalKey: restKey, amount: rest,
          paidAt: isDate(s.paid_remainder_at) ? s.paid_remainder_at! : saleDate,
          kind: prepay > 0 ? 'remainder' : 'full',
          source: 'reconcile_retail', method, crmSaleId: s.id, orderId: s.order_id,
          enteredByName: s.manager, importBatch: 'reconcile',
        })
        stat.retail++
      } else if (liveKeys.has(restKey)) {
        await voidPayment(svc, restKey)
      }
    } catch (e) {
      if (stat.errors.length < 20) stat.errors.push(`sale#${s.id}: ${e instanceof Error ? e.message : 'ошибка'}`)
    }
  }

  const { count: liveCount } = await svc.from('payments')
    .select('*', { count: 'exact', head: true }).is('voided_at', null)

  return NextResponse.json({ ok: true, ...stat, corePayments: liveCount })
}
