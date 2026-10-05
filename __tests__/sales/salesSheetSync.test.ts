import { describe, it, expect } from 'vitest'
import { planMonth, orphanLimit, formatSyncReport, type SheetSale, type ExistingSale, type MonthReport } from '@/lib/sales/salesSheetSync'

const sale = (row: number, order_no: string | null, over: Partial<SheetSale> = {}): SheetSale => ({
  row, external_key: `gsheet:Август 26:${row}`, amount_text: null, ledger_month: '2026-08',
  sale_date: '2026-08-03', ready_date: null, department: 'mglass', order_no, client: 'К',
  amount: 1000, partner_fee: 0, prepayment: 0, prepayment_paid: false, remainder_paid: false,
  payment_method: 'Счёт', manager: 'Яна', status: 'open', needs_review: false, ...over,
})
const existing = (id: number, row: number, order_no: string | null, over: Partial<ExistingSale> = {}): ExistingSale => {
  const fields: Record<string, unknown> = { ...sale(row, order_no) }
  delete fields.row
  delete fields.amount_text
  return { id, voided: false, ...fields, ...over } as ExistingSale
}

describe('синхронизация книги: сопоставление строк', () => {
  it('без изменений — ничего не пишется', () => {
    const p = planMonth([sale(6, 'A'), sale(7, 'B')], [existing(1, 6, 'A'), existing(2, 7, 'B')])
    expect(p.inserts).toHaveLength(0)
    expect(p.orphans).toHaveLength(0)
    expect(p.matched.every(m => m.changed.length === 0 && !m.rekey)).toBe(true)
  })

  it('вставили строку посередине: продажи едут за номером заказа, новая — новая', () => {
    const sheet = [sale(6, 'A'), sale(7, 'NEW'), sale(8, 'B')]
    const p = planMonth(sheet, [existing(1, 6, 'A'), existing(2, 7, 'B')])
    expect(p.inserts.map(s => s.order_no)).toEqual(['NEW'])
    const b = p.matched.find(m => m.sale.order_no === 'B')!
    expect(b.row.id).toBe(2)
    expect(b.rekey).toBe(true)
    expect(b.changed).toEqual([])
    expect(p.orphans).toHaveLength(0)
  })

  it('исправленный в книге номер заказа — та же продажа, а не новая', () => {
    const p = planMonth([sale(33, '0959-2')], [existing(5, 33, '0969-2')])
    expect(p.inserts).toHaveLength(0)
    expect(p.matched[0]).toMatchObject({ rekey: false, changed: ['order_no'] })
  })

  it('строки нет в книге — лишняя; погашенная, но вернувшаяся — оживает', () => {
    const p = planMonth([sale(7, 'B')], [existing(1, 6, 'A'), existing(2, 7, 'B', { voided: true })])
    expect(p.orphans.map(r => r.id)).toEqual([1])
    expect(p.matched[0]).toMatchObject({ revive: true })
  })

  it('оплата остатка позеленела — меняются только отметка и статус', () => {
    const p = planMonth([sale(6, 'A', { remainder_paid: true, status: 'closed' })], [existing(1, 6, 'A')])
    expect(p.matched[0].changed).toEqual(['remainder_paid', 'status'])
  })

  it('числа из базы строкой не считаются изменением', () => {
    const p = planMonth([sale(6, 'A', { amount: 95900 })], [existing(1, 6, 'A', { amount: '95900.00' as unknown as number })])
    expect(p.matched[0].changed).toEqual([])
  })

  it('порог «слишком много пропало»: не меньше трёх и 15% месяца', () => {
    expect(orphanLimit(10)).toBe(3)
    expect(orphanLimit(40)).toBe(6)
  })
})

const month = (over: Partial<MonthReport> = {}): MonthReport => ({
  tab: 'Август 26', month: '2026-08', sheetCount: 2, sheetSum: 2000, bookTotal: 2000,
  inserted: [], updated: [], revived: 0, voided: [], orphansHeld: false, textAmounts: [],
  skipped: [], noDate: [], dateOutside: [], regCount: 2, regSum: 2000, managerDiffs: [], extraInRegistry: [], ...over,
})

describe('синхронизация книги: отчёт владельцу', () => {
  it('всё сошлось — одна строка на месяц', () => {
    expect(formatSyncReport({ dry: false, months: [month()] })).toContain('✅ август 2026: 2 · 2 000 ₽')
  })

  it('сумма текстом в книге: реестр верен, итог книги — нет, и сказано, что править', () => {
    const t = formatSyncReport({ dry: false, months: [month({
      bookTotal: 1000, textAmounts: [{ row: 6, order_no: '0907-4', raw: 'По 1 000', amount: 1000 }],
    })] })
    expect(t).toContain('✏️ август 2026')
    expect(t).toContain('Август 26, строка 6, 0907-4: сумма набрана текстом «По 1 000»')
  })

  it('имя клиента с угловыми скобками не ломает разметку Telegram', () => {
    const t = formatSyncReport({ dry: false, months: [month({
      voided: [{ order_no: '1', client: 'ООО <Рога & Копыта>', manager: 'Яна', amount: 5 }],
    })] })
    expect(t).toContain('ООО &lt;Рога &amp; Копыта&gt;')
  })
})
