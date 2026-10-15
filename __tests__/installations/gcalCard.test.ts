import { describe, it, expect } from 'vitest'
import { amountOf, cardFields, crewOf, kindOf, parseCalendarCard, timeWindow } from '@/lib/installations/gcalCard'

// Форматы — как в календаре офиса за сентябрь–октябрь 2026; люди, телефоны и адреса выдуманы.
const row = (k: string, v: string) => `<tr><td><b>${k}</b></td><td>${v}</td><td></td></tr>`
const table = (rows: string) => `<table dir="ltr"><colgroup><col /><col /></colgroup><tbody>${rows}</tbody></table>`
const ev = (id: string, summary: string, description: string, start = '2026-09-01T10:00:00+03:00') =>
  ({ id, summary, description, start: { dateTime: start }, updated: '2026-08-31T08:48:46Z', status: 'confirmed' })

describe('карточка монтажа из календаря', () => {
  it('таблица: все поля, перенос внутри адреса, сумма с пометкой про остаток', () => {
    const c = parseCalendarCard(ev('a1', '#0901-4 Душевая', table(
      row('Время', '9:30-10:00') + row('Номер заказа', '#0901-4') + row('Бригада', 'Арген,Женя') +
      row('Изделие', 'Душевая') + row('ФИО', 'Иван') +
      row('Адрес', '<b><br><br>г. Москва, ул. Пример, д. 1, кв. 2</b>') +
      row('Пропуск', '<b>позвонить за час заказать пропуск</b>') + row('телефон ', '89990000001') +
      row('сумма монтажа', '<b>12500(16050 руб остаток оплатит на месте)</b>') + '<tr><td></td><td></td><td></td></tr>')))
    expect(c).toMatchObject({
      external_key: 'gcal:a1', order_no: '0901-4', order_nos: ['0901-4'], title: 'Душевая', kind: 'install',
      client_name: 'Иван', phone: '89990000001', address: 'г. Москва, ул. Пример, д. 1, кв. 2',
      entry_note: 'позвонить за час заказать пропуск', scheduled_date: '2026-09-01', time_from: '09:30', time_to: '10:00',
      crew_members: ['Арген', 'Женя'], amount: 12500, amount_note: '(16050 руб остаток оплатит на месте)', comment: null,
    })
  })

  it('столбик текста: подпись и значение через пустые строки, сумма в одной строке с подписью', () => {
    const c = parseCalendarCard(ev('a2', '#0902-2', 'Время\n10:00\n\nНомер заказа\n#0902-2\n\nБригада\nАрген\n\nИзделие\nРама в проеме (демонтаж-монтаж) \nФИО\nПётр\nАдрес\n\n\nМосква, ул. Пример, 5\nПропуск\nпозвонить за час заказать пропуск\nтелефон \n89990000002\nсумма монтажа 15.000 (платит на месте)'))
    expect(c).toMatchObject({ order_no: '0902-2', crew_members: ['Арген'], address: 'Москва, ул. Пример, 5', time_from: '10:00', time_to: null, amount: 15000, amount_note: '(платит на месте)', kind: 'rework' })
  })

  it('телефон и сумма слиты в одну строку таблицы; два телефона', () => {
    const merged = '<tr><td><br><b>телефон <br>сумма монтажа         </b></td><td>89990000003<br>5000</td></tr>'
    const c = parseCalendarCard(ev('a3', '#0639-2 Душевая реклам', table(row('Время', '15:00') + row('Номер заказа', '#0639-2') + row('Бригада', 'Арген') + row('Изделие', 'Раздвижка (сели двери)') + merged)))
    expect(c).toMatchObject({ phone: '89990000003', amount: 5000, kind: 'claim' })
    const two = parseCalendarCard(ev('a4', '#0875-2 Реклам', table(row('Номер заказа', '#0875-2') + row('Бригада', 'Арген,Женя') + row('телефон ', '<br>89990000004<br><br>89990000005') + row('сумма монтажа', '<br>'))))
    expect(two).toMatchObject({ phone: '89990000004 89990000005', amount: null, amount_note: null })
  })

  it('сумма монтажа в ячейке телефона', () => {
    const c = parseCalendarCard(ev('a5', '#0943-3', table(row('Номер заказа', '#0943-3') + row('Бригада', 'Женя,Арген') + row('Изделие', 'Душевая с собой стекло переделка') + row('телефон ', '<br>89990000006<br><br>сумма монтажа 20.000'))))
    expect(c).toMatchObject({ phone: '89990000006', amount: 20000, kind: 'rework' })
  })

  it('один выезд на три заказа; номер с подномером; заметка «набрать» из заголовка', () => {
    const c = parseCalendarCard(ev('a6', '#0869-2+0829-2+0823-2 (набрать заранее)', table(row('Номер заказа', '#0829-2+0823-2+0869-2') + row('Бригада', 'Арген') + row('сумма монтажа', '26.000'))))
    expect(c).toMatchObject({ order_no: '0829-2+0823-2+0869-2', order_nos: ['0829-2', '0823-2', '0869-2'], amount: 26000, contact_before: 'набрать заранее' })
    expect(parseCalendarCard(ev('a7', '#0579-2-3 Реклам', table(row('Номер заказа', '#0579-2-3') + row('Бригада', 'Арген,Женя'))))!.order_nos).toEqual(['0579-2-3'])
  })

  it('время словами — окна нет, слова в комментарии', () => {
    const c = parseCalendarCard(ev('a9', '#0796-2 Рекламация', table(row('Время', 'вторая половина дня') + row('Номер заказа', '#0796-2 Рекламация') + row('Бригада', 'Арген,Женя'))))
    expect(c).toMatchObject({ order_no: '0796-2', time_from: null, comment: 'Время: вторая половина дня', kind: 'claim' })
  })

  it('строки без подписи уходят в комментарий дословно', () => {
    const c = parseCalendarCard(ev('a8', '#01011-0 Лофт', table(row('Номер заказа', '#01011-0') + row('Бригада', 'Арген,Женя') +
      '<tr><td><br></td><td><br><b>в понедельник второй этап<br>чек общий запишем<br></b></td></tr>')))
    expect(c!.comment).toBe('в понедельник второй этап чек общий запишем')
  })

  it('не карточка: личное событие, отгрузка без формы, отменённое', () => {
    expect(parseCalendarCard(ev('b1', 'Поездка Москва — Клин', 'Пригородный поезд\nДата отправления: 03.10.2026'))).toBeNull()
    expect(parseCalendarCard(ev('b2', '0874-2- отгрузка', ''))).toBeNull()
    expect(parseCalendarCard({ ...ev('b3', '#0901-4', table(row('Номер заказа', '#0901-4') + row('Бригада', 'Арген'))), status: 'cancelled' })).toBeNull()
  })
})

describe('поля по отдельности', () => {
  it('окно времени', () => {
    expect(timeWindow('11-12:00')).toEqual({ from: '11:00', to: '12:00' })
    expect(timeWindow('14:00-15:00')).toEqual({ from: '14:00', to: '15:00' })
    expect(timeWindow('')).toEqual({ from: null, to: null })
  })
  it('сумма: слагаемые складываются и остаются в пометке; нет числа — только пометка', () => {
    expect(amountOf('20000+5000')).toEqual({ amount: 25000, note: '20000+5000' })
    expect(amountOf('12500(одно зеркало не встало)')).toEqual({ amount: 12500, note: '(одно зеркало не встало)' })
    expect(amountOf('бесплатно')).toEqual({ amount: null, note: 'бесплатно' })
  })
  it('бригада: разделители и хвост в скобках', () => {
    expect(crewOf('Арген.Женя')).toEqual(['Арген', 'Женя'])
    expect(crewOf('Арген,Женя(реклам-зеркало)')).toEqual(['Арген', 'Женя'])
  })
  it('вид выезда: заголовок важнее изделия', () => {
    expect(kindOf('#0907-4 Доделка', 'Душевая доделка (заменить уплотнитель)')).toBe('rework')
    expect(kindOf('#0554-2 Реклам', 'Гарантийный (заменить доводчик)')).toBe('claim')
    expect(kindOf('#0160-0 Лофты', 'лофты 2й этап')).toBe('stage')
    expect(kindOf('#0939-3', 'Зеркало (не горит)')).toBe('claim')
    expect(kindOf('#0913-4 Душевая', 'Душевая')).toBe('install')
  })
  it('пустое описание — пустые поля', () => {
    expect(cardFields(null)).toEqual({ extra: [] })
  })
})
