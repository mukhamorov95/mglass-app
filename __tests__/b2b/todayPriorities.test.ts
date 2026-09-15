import { describe, it, expect } from 'vitest'
import {
  overdueShipments, unpaidInvoices, staleQuotes, otherBuckets, daysText,
  type TodayOrder, type TodayInvoice,
} from '@/lib/b2b/todayPriorities'

const NOW = Date.parse('2026-09-15T12:00:00Z')
const iso = (s: string) => new Date(s).toISOString()

const order = (id: number, o: Partial<TodayOrder> & { n?: Record<string, unknown> } = {}): TodayOrder => ({
  id, client_name: `Клиент ${id}`, custom_number: null, total_sale_inc_vat: 100_000, total_after_discount: null,
  notes: o.n ? JSON.stringify(o.n) : null, created_at: iso('2026-08-01'), updated_at: null, launched_at: null,
  created_by_name: 'Алина', ...o,
})

describe('просроченные отгрузки', () => {
  it('срок прошёл, отметки нет — в списке с числом дней и ответственным', () => {
    const rows = overdueShipments([order(1, { launched_at: iso('2026-08-20'), n: { deadline_date: '2026-09-10' } })], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ref: '#1', href: '/b2b-deal/1', days: 5, owner: 'Алина', daysLabel: 'просрочка 5 дней' })
  })
  it('отгружен — не в списке, в том числе старой отметкой true', () => {
    const rows = overdueShipments([
      order(1, { launched_at: iso('2026-08-20'), n: { deadline_date: '2026-09-10', stages: { shipped: '2026-09-11' } } }),
      order(2, { launched_at: iso('2026-08-20'), n: { deadline_date: '2026-09-10', stages: { shipped: true } } }),
    ], NOW)
    expect(rows).toEqual([])
  })
  it('поле shipped_date не считается — его никто не пишет', () => {
    const rows = overdueShipments([order(1, { launched_at: iso('2026-08-20'), n: { deadline_date: '2026-09-10', shipped_date: '2026-09-11' } })], NOW)
    expect(rows).toHaveLength(1)
  })
  it('срок раньше возврата отметки (01.09) — не показываем: отметить было нечем', () => {
    const rows = overdueShipments([order(1, { launched_at: iso('2026-07-20'), n: { deadline_date: '2026-08-25' } })], NOW)
    expect(rows).toEqual([])
  })
  it('не запущен или срок впереди — не в списке', () => {
    expect(overdueShipments([order(1, { n: { deadline_date: '2026-09-10' } })], NOW)).toEqual([])
    expect(overdueShipments([order(2, { launched_at: iso('2026-09-01'), n: { deadline_date: '2026-09-20' } })], NOW)).toEqual([])
  })
  it('срок без явной даты — от колонки launched_at, а не от создания', () => {
    // запуск 20.08 + 15 рабочих дней = 10.09 → просрочка; от создания 01.08 срок был бы 21.08 — до отметок
    const rows = overdueShipments([order(1, { launched_at: iso('2026-08-20') })], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].days).toBe(5)
  })
  it('сначала самые просроченные', () => {
    const rows = overdueShipments([
      order(1, { launched_at: iso('2026-08-20'), n: { deadline_date: '2026-09-12' } }),
      order(2, { launched_at: iso('2026-08-20'), n: { deadline_date: '2026-09-02' } }),
    ], NOW)
    expect(rows.map(r => r.ref)).toEqual(['#2', '#1'])
  })
})

const invoice = (id: number, o: Partial<TodayInvoice> = {}): TodayInvoice => ({
  id, invoice_no: String(100 + id), payer_name: 'ООО Стекло', order_ids: [id], amount: 50_000, status: 'issued',
  issued_at: iso('2026-09-05'), created_at: iso('2026-09-05'), created_by_name: 'Яна',
  derivedStatus: 'unpaid', paid: 0, remainder: 50_000, ...o,
})

describe('счета ждут оплаты — по платежам, а не по флажку', () => {
  it('неоплаченный и частично оплаченный — в списке, оплаченный и отменённый — нет', () => {
    const rows = unpaidInvoices([
      invoice(1),
      invoice(2, { derivedStatus: 'partial', paid: 20_000, remainder: 30_000 }),
      invoice(3, { derivedStatus: 'paid', paid: 50_000, remainder: 0 }),
      invoice(4, { status: 'cancelled' }),
    ], NOW)
    expect(rows.map(r => r.key)).toEqual(['inv-1', 'inv-2'])
    expect(rows[1]).toMatchObject({ amount: 30_000, note: `оплачено ${(20_000).toLocaleString('ru-RU')} ₽, остаток` })
  })
  it('один заказ — ссылка на карточку, несколько — в реестр счетов', () => {
    const rows = unpaidInvoices([invoice(1), invoice(2, { order_ids: [5, 6], issued_at: iso('2026-09-01') })], NOW)
    expect(rows.find(r => r.key === 'inv-1')?.href).toBe('/b2b-deal/1')
    expect(rows.find(r => r.key === 'inv-2')?.href).toBe('/b2b-invoices')
    expect(rows[0].key).toBe('inv-2')
    expect(rows[0].daysLabel).toBe('выставлен 14 дней назад')
  })
})

describe('просчёты без движения', () => {
  it('3–45 дней без изменений, не открыт клиентом, по сумме от большей', () => {
    const rows = staleQuotes([
      order(1, { updated_at: iso('2026-09-10'), total_sale_inc_vat: 50_000 }),
      order(2, { updated_at: iso('2026-09-01'), total_sale_inc_vat: 300_000 }),
      order(3, { updated_at: iso('2026-09-14') }),
      order(4, { updated_at: iso('2026-07-01') }),
      order(5, { updated_at: iso('2026-09-01'), n: { public_opened_at: '2026-09-02' } }),
      order(6, { updated_at: iso('2026-09-01'), launched_at: iso('2026-09-02') }),
      order(7, { updated_at: iso('2026-09-01'), n: { status: 'agreed' } }),
    ], NOW)
    expect(rows.map(r => r.ref)).toEqual(['#2', '#1'])
    expect(rows[0].daysLabel).toBe('без движения 14 дней')
  })
})

describe('остальные дела', () => {
  it('вопрос клиента, согласовано, отгрузка на неделе; пустые группы скрыты', () => {
    const b = otherBuckets([
      order(1, { n: { client_response: { action: 'question', comment: 'а толщина?', at: '2026-09-14T10:00:00Z' } } }),
      order(2, { n: { status: 'agreed' } }),
      order(3, { launched_at: iso('2026-09-01'), n: { deadline_date: '2026-09-18' } }),
    ], NOW)
    expect(b.map(x => x.key)).toEqual(['answered', 'agreed', 'shipweek'])
    expect(b[0].rows[0].note).toBe('«а толщина?»')
    expect(b[2].rows[0].daysLabel).toBe('через 3 дня')
  })
  it('шаблоны не попадают никуда', () => {
    const t = order(1, { launched_at: iso('2026-08-20'), n: { is_template: true, deadline_date: '2026-09-10' } })
    expect(overdueShipments([t], NOW)).toEqual([])
    expect(staleQuotes([order(2, { updated_at: iso('2026-09-01'), n: { is_template: true } })], NOW)).toEqual([])
  })
})

it('склонение дней', () => {
  expect([1, 2, 5, 11, 21, 22, 25].map(daysText)).toEqual(['1 день', '2 дня', '5 дней', '11 дней', '21 день', '22 дня', '25 дней'])
})
