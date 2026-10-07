import { describe, it, expect } from 'vitest'
import {
  overdueShipments, unpaidInvoices, staleQuotes, otherBuckets, daysText,
  splitShipments, backfillCandidates, backfillDateProblem, SHIP_RECENT_DAYS,
  readyNotShipped, updToIssue,
  type TodayOrder, type TodayInvoice,
} from '@/lib/b2b/todayPriorities'
import type { UpdStatus } from '@/lib/b2b/updStatus'

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
  it('3–30 дней без изменений, не открыт клиентом, по сумме от большей', () => {
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
  it('31 день — уже не в списке; у строки — текст напоминания с номером и суммой', () => {
    const rows = staleQuotes([
      order(1, { updated_at: iso('2026-08-15'), total_sale_inc_vat: 80_000 }),
      order(2, { updated_at: iso('2026-08-16'), total_sale_inc_vat: 120_500, custom_number: '05601', n: { quote_date: '2026-08-14T09:00:00Z' } }),
    ], NOW)
    expect(rows.map(r => r.ref)).toEqual(['05601'])
    expect(rows[0].copy?.label).toBe('📋 Напомнить о КП')
    expect(rows[0].copy?.text).toContain('№ 05601 от 14.08.2026')
    expect(rows[0].copy?.text).toContain(`${(120_500).toLocaleString('ru-RU')} ₽`)
  })
})

describe('готов, не отгружен', () => {
  const packed = (id: number, day: string, extra: Record<string, unknown> = {}) =>
    order(id, { launched_at: iso('2026-09-01'), n: { deadline_date: '2026-09-30', stages: { packaged: day }, ...extra } })

  it('упакован до 14 дней назад, не отгружен — давние сверху, с днями ожидания', () => {
    const rows = readyNotShipped([
      packed(1, '2026-09-14'),
      packed(2, '2026-09-05T15:00:00+03:00'),
      packed(3, '2026-08-20'),                                   // старше 14 дней — в хвост разбора
      order(4, { launched_at: iso('2026-09-01'), n: { stages: { packaged: '2026-09-10', shipped: '2026-09-11' } } }),
      order(5, { launched_at: iso('2026-09-01'), n: { stages: {} } }),
    ], NOW)
    expect(rows.map(r => r.ref)).toEqual(['#2', '#1'])
    expect(rows[0]).toMatchObject({ daysLabel: 'ждёт 10 дней', actionHref: '/b2b-today/shipments?order=2', href: '/b2b-deal/2' })
    expect(rows[0].copy?.label).toBe('📋 Текст: готов к выдаче')
    expect(rows[0].copy?.text).toContain('№ 00002 готов')
  })
  it('уже стоит в просроченных отгрузках — второй раз не показываем', () => {
    expect(readyNotShipped([packed(1, '2026-09-14')], NOW, new Set(['ship-1']))).toEqual([])
  })
  it('у просроченного упакованного — тот же текст в строке', () => {
    const [r] = overdueShipments([order(1, { launched_at: iso('2026-08-20'), n: { deadline_date: '2026-09-10', stages: { packaged: '2026-09-09' } } })], NOW)
    expect(r.copy?.label).toBe('📋 Текст: готов к выдаче')
    const [r2] = overdueShipments([order(2, { launched_at: iso('2026-08-20'), n: { deadline_date: '2026-09-10' } })], NOW)
    expect(r2.copy).toBeUndefined()
  })
})

describe('выдать УПД', () => {
  const shipped = (id: number, day: string) =>
    order(id, { launched_at: iso('2026-09-01'), n: { stages: { packaged: day, shipped: day } } })
  const status = (o: Partial<UpdStatus['series']> = {}, eligible = [1, 2, 3], issued: UpdStatus['issued'] = {}): UpdStatus => ({
    issued, eligible, series: { pendingSql: false, set: true, switchDay: '2026-09-10', ...o },
  })

  it('отгружен после включения серии, ИНН есть, УПД не выдан — в списке', () => {
    const rows = updToIssue([shipped(1, '2026-09-12'), shipped(2, '2026-09-08'), shipped(3, '2026-09-11'), shipped(4, '2026-09-12')],
      status({}, [1, 2, 3], { 3: { number: 533, year: 2026, doc_date: '2026-09-11' } }), NOW)
    expect(rows.map(r => r.ref)).toEqual(['#1'])
    expect(rows[0]).toMatchObject({ actionHref: '/b2b-quotes/1/upd', daysLabel: 'отгружен 3 дня назад' })
  })
  it('серия не задана, SQL не выполнен или день включения неизвестен — группы нет', () => {
    const o = [shipped(1, '2026-09-12')]
    expect(updToIssue(o, status({ set: false, switchDay: null }), NOW)).toEqual([])
    expect(updToIssue(o, status({ pendingSql: true }), NOW)).toEqual([])
    expect(updToIssue(o, status({ switchDay: undefined }), NOW)).toEqual([])
    expect(updToIssue(o, null, NOW)).toEqual([])
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

describe('разбор старых отгрузок (решение владельца 30.09)', () => {
  const late = (id: number, deadline: string, stages: Record<string, unknown> = {}) =>
    order(id, { launched_at: iso('2026-08-20'), n: { deadline_date: deadline, stages } })

  it('сверху — последние 14 дней, старше — в хвост', () => {
    // Ровно 14 дней — ещё «последние»; хвост начинается с 15-го.
    const LATER = Date.parse('2026-09-25T12:00:00Z')
    const rows = overdueShipments([late(1, '2026-09-20'), late(2, '2026-09-11'), late(3, '2026-09-05')], LATER)
    const { recent, old } = splitShipments(rows)
    expect(recent.map(r => r.ref).sort()).toEqual(['#1', '#2'])
    expect(old.map(r => r.ref)).toEqual(['#3'])
    expect(old[0].days).toBeGreaterThan(SHIP_RECENT_DAYS)
  })

  it('кнопка строки ведёт на разбор этого заказа, ссылка номера — в карточку', () => {
    const [r] = overdueShipments([late(7, '2026-09-10')], NOW)
    expect(r.href).toBe('/b2b-deal/7')
    expect(r.actionHref).toBe('/b2b-today/shipments?order=7')
  })

  it('дата по умолчанию — день упаковки, иначе срок; не сегодняшняя', () => {
    const rows = backfillCandidates([
      late(1, '2026-09-05', { packaged: '2026-09-03T09:30:00+03:00' }),
      late(2, '2026-09-04'),
    ], NOW)
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(byId[1]).toMatchObject({ packagedDay: '2026-09-03', defaultDate: '2026-09-03', deadlineDay: '2026-09-05' })
    expect(byId[2]).toMatchObject({ packagedDay: null, defaultDate: '2026-09-04' })
  })

  it('упакованный попадает в разбор и до срока; дни — от упаковки', () => {
    const rows = backfillCandidates([
      order(1, { launched_at: iso('2026-08-20'), n: { deadline_date: '2026-09-30', stages: { packaged: '2026-08-25' } } }),
    ], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 1, days: 21, overdueDays: null, defaultDate: '2026-08-25' })
  })

  it('срок до 01.09 — тоже в разбор: «Отметить месяц» из заказов теперь ведёт сюда', () => {
    const rows = backfillCandidates([order(1, { launched_at: iso('2026-07-20'), n: { deadline_date: '2026-08-25' } })], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ overdueDays: 21, defaultDate: '2026-08-25' })
  })

  it('отгруженные, шаблоны и незапущенные в разбор не попадают', () => {
    const rows = backfillCandidates([
      late(1, '2026-09-05', { shipped: '2026-09-06' }),
      order(2, { launched_at: iso('2026-08-20'), n: { deadline_date: '2026-09-05', is_template: true } }),
      order(3, { n: { deadline_date: '2026-09-05' } }),
    ], NOW)
    expect(rows).toEqual([])
  })

  it('проверка даты: будущее и раньше запуска — нельзя', () => {
    expect(backfillDateProblem('2026-09-10', '2026-09-15', '2026-08-20')).toBeNull()
    expect(backfillDateProblem('2026-09-16', '2026-09-15', null)).toBe('дата в будущем')
    expect(backfillDateProblem('2026-08-19', '2026-09-15', '2026-08-20')).toMatch(/раньше запуска/)
    expect(backfillDateProblem('10.09.2026', '2026-09-15', null)).toBe('дата не распознана')
  })
})
