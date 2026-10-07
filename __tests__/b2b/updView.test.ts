import { describe, it, expect } from 'vitest'
import { buildUpdBody, draftUpdView, issuedUpdView, nextUpdNumber, updDateError, updIssueBlockers } from '@/lib/b2b/updView'
import { updLines } from '@/lib/b2b/updLines'
import type { InvoiceOrder, InvoiceRequisites } from '@/lib/b2b/invoiceMath'

const order: InvoiceOrder = {
  id: 5544, custom_number: '05544', discount_percent: 0, created_at: '2026-09-25T10:00:00Z',
  notes: JSON.stringify({ quote_date: '2026-09-25' }),
  total_sale_inc_vat: 36_600, total_after_discount: 36_600,
  items: [
    { materialName: 'Зеркало', thickness: 4, quantity: 2, saleIncVat: 12_200, width: 600, height: 800 },
    { materialName: 'Стекло', thickness: 8, quantity: 1, saleIncVat: 24_400, hasTempering: true },
  ],
}
const req: InvoiceRequisites = {
  full_name: 'ООО «Ромашка»', inn: '7700000000', kpp: '770001001', ogrn: '', legal_address: 'Москва, ул. Лесная, 1',
  bank_account: '40702810000000000001', bank_name: 'Банк', bik: '044525000', corr_account: '', supply_contract_no: '', supply_contract_date: '',
}

describe('содержимое УПД', () => {
  it('строки и итоги — те же, что в updLines; названия позиций зашиты в документ', () => {
    const b = buildUpdBody(order, req, 'Ромашка', '2026-10-07')
    const { lines, totals } = updLines(order, '2026-10-07')
    expect(b.totals).toEqual(totals)
    expect(b.lines.map(l => l.sumIncVat)).toEqual(lines.map(l => l.sumIncVat))
    expect(b.lines[0].name).toBe('Зеркало, 4 мм, 600×800 мм')
    expect(b.lines[1]).toMatchObject({ name: 'Стекло, 8 мм, закалённое', unitCode: '796', unitName: 'шт', qty: 1 })
  })

  it('в снимок не попадают банковские реквизиты покупателя и данные заказа сверх печатного', () => {
    const json = JSON.stringify(buildUpdBody(order, req, 'Ромашка', '2026-10-07'))
    expect(json).not.toContain('40702810000000000001')
    expect(json).not.toContain('saleIncVat')
  })

  it('без рамочного договора — договор по номеру заказа и дате просчёта', () => {
    expect(buildUpdBody(order, req, 'Ромашка', '2026-10-07').contract).toBe('Договор поставки № 05544 от 25.09.2026')
    expect(buildUpdBody(order, { ...req, supply_contract_no: '12/26', supply_contract_date: '2026-01-15' }, 'Ромашка', '2026-10-07').contract)
      .toBe('Договор поставки № 12/26 от 15.01.2026')
  })

  it('черновик — «б/н», выданный — номер и дата из реестра, содержимое из снимка', () => {
    expect(draftUpdView(order, req, 'Ромашка', '2026-10-07')).toMatchObject({ number: 'б/н', docDate: '2026-10-07' })
    const snapshot = buildUpdBody(order, req, 'Ромашка', '2026-10-07')
    const changed = { ...order, total_after_discount: 1 }
    const v = issuedUpdView({ year: 2026, number: 533, doc_date: '2026-10-07', snapshot, issued_at: '2026-10-07T09:00:00Z', issued_by_name: null })
    expect(v.number).toBe('533')
    expect(v.totals.sumIncVat).toBe(36_600)
    expect(buildUpdBody(changed, req, 'Ромашка', '2026-10-07').totals.sumIncVat).toBe(1)
  })

  it('без ИНН покупателя УПД не выдаётся', () => {
    expect(updIssueBlockers(buildUpdBody(order, { ...req, inn: '' }, 'Ромашка', '2026-10-07'))).toEqual(['нет ИНН покупателя'])
    expect(updIssueBlockers(buildUpdBody(order, req, 'Ромашка', '2026-10-07'))).toEqual([])
    expect(updIssueBlockers(buildUpdBody({ ...order, items: [], total_sale_inc_vat: 0, total_after_discount: 0 }, req, 'Р', '2026-10-07')))
      .toEqual(['в заказе нет позиций'])
  })
})

describe('серия и дата', () => {
  it('следующий номер продолжает серию программы, а не начинает с 1', () => {
    expect(nextUpdNumber(533, null)).toBe(533)
    expect(nextUpdNumber(533, 540)).toBe(541)
    expect(nextUpdNumber(533, 12)).toBe(533)
  })

  it('дата: формат, не раньше заказа, не дальше месяца вперёд', () => {
    expect(updDateError('2026-10-07', order.created_at, '2026-10-07')).toBeNull()
    expect(updDateError('07.10.2026', order.created_at, '2026-10-07')).toMatch('формате')
    expect(updDateError('2026-09-24', order.created_at, '2026-10-07')).toMatch('раньше')
    expect(updDateError('2026-11-06', order.created_at, '2026-10-07')).toBeNull()
    expect(updDateError('2026-11-07', order.created_at, '2026-10-07')).toMatch('месяца')
  })
})
