import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { amountDue, loadPaidByOrders, paymentView } from '@/lib/partner/orderMoney'
import { effectiveItemTotal, type B2BOrderItem } from '@/lib/b2bCalculator'

type R = Record<string, unknown>

// Подделка PostgREST: режет ответ на 1000 строк, как прод.
function fakeSvc(tables: Record<string, R[]>): SupabaseClient {
  return {
    from(table: string) {
      const preds: ((r: R) => boolean)[] = []
      let key: string | null = null
      const b = {
        select: () => b,
        in: (col: string, vals: unknown[]) => { const s = new Set(vals.map(Number)); preds.push(r => s.has(Number(r[col]))); return b },
        is: (col: string, v: unknown) => { preds.push(r => (r[col] ?? null) === v); return b },
        overlaps: (col: string, vals: unknown[]) => { const s = new Set(vals.map(Number)); preds.push(r => Array.isArray(r[col]) && (r[col] as unknown[]).some(x => s.has(Number(x)))); return b },
        order: (col: string) => { key = col; return b },
        range: async (from: number, to: number) => {
          let rows = (tables[table] ?? []).filter(r => preds.every(p => p(r)))
          if (key) { const k = key; rows = [...rows].sort((a, c) => Number(a[k]) - Number(c[k])) }
          return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null }
        },
      }
      return b
    },
  } as unknown as SupabaseClient
}

describe('оплачено по заказу — из payments', () => {
  it('прямой платёж + доля мульти-заказного счёта, войднутый не считается', async () => {
    const svc = fakeSvc({
      b2b_orders: [
        { id: 10, total_after_discount: 30000, total_sale_inc_vat: 33000 },
        { id: 11, total_after_discount: 10000, total_sale_inc_vat: 10000 },
      ],
      invoices: [{ id: 7, order_ids: [10, 11], amount: 40000 }],
      payments: [
        { id: 1, amount: 5000, b2b_order_id: 10, invoice_id: null, voided_at: null },
        { id: 2, amount: 8000, b2b_order_id: null, invoice_id: 7, voided_at: null },
        { id: 3, amount: 99999, b2b_order_id: 10, invoice_id: null, voided_at: '2026-10-01T10:00:00Z' },
      ],
    })
    const paid = await loadPaidByOrders(svc, [10])
    // 5000 напрямую + 8000 × 30000/40000 = 6000
    expect(paid.get(10)).toBe(11000)
  })
  it('пустой список — без запросов', async () => {
    expect((await loadPaidByOrders(fakeSvc({}), [])).size).toBe(0)
  })
})

describe('что сказать партнёру об оплате', () => {
  it('частичная оплата — «оплачено X из Y, осталось Z», к оплате — остаток', () => {
    const v = paymentView({ total: 30000, paidFromPayments: 11000, notes: {}, due: true })
    expect(v).toEqual({ status: 'partial', paid: 11000, total: 30000, remainder: 19000 })
    expect(amountDue(v)).toBe(19000)
  })
  it('платежей нет, менеджер отметил предоплату — она и считается', () => {
    const v = paymentView({ total: 30000, paidFromPayments: 0, notes: { payment_status: 'partial', prepayment_amount: 15000 }, due: true })
    expect(v).toEqual({ status: 'partial', paid: 15000, total: 30000, remainder: 15000 })
  })
  it('отметка «Оплачен» или платежи покрыли сумму — оплачен, к оплате 0', () => {
    expect(paymentView({ total: 30000, paidFromPayments: 0, notes: { payment_status: 'paid' }, due: true })).toEqual({ status: 'paid' })
    expect(paymentView({ total: 30000, paidFromPayments: 30000, notes: {}, due: true })).toEqual({ status: 'paid' })
    expect(amountDue({ status: 'paid' })).toBe(0)
  })
  it('ничего не оплачено: в работе — «ожидает оплаты» на всю сумму; просчёт — молчим', () => {
    const v = paymentView({ total: 30000, paidFromPayments: 0, notes: {}, due: true })
    expect(v).toEqual({ status: 'awaiting', total: 30000 })
    expect(amountDue(v)).toBe(30000)
    expect(paymentView({ total: 30000, paidFromPayments: 0, notes: {}, due: false })).toBeNull()
  })
})

describe('сумма позиции в карточке = как у менеджера', () => {
  it('позиция из индивидуального прайса — без повторной скидки', () => {
    const it = { saleIncVat: 10000, clientPriced: true } as unknown as B2BOrderItem
    expect(effectiveItemTotal(it, 10)).toBe(10000)
  })
  it('обычная позиция — со скидкой, договорная — как вписана', () => {
    expect(effectiveItemTotal({ saleIncVat: 10000 } as unknown as B2BOrderItem, 10)).toBe(9000)
    expect(effectiveItemTotal({ saleIncVat: 10000, manualTotal: 8500 } as unknown as B2BOrderItem, 10)).toBe(8500)
  })
})
