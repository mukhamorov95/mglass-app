import { describe, expect, it } from 'vitest'
import { checkMontage, collectMontage, loadMontageBook, orderKey, parseMontageCsv } from '@/lib/sales/montageBook'

const csv = (rows: string[][]) => rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')

// Шапка как в живой книге: имена монтажников меняются, справа от «Дима РОР» — реестр выплат.
const SEP_26 = csv([
  ['Сентябрь 26', '', '', '', '', '', '', '', ''],
  ['№ ЗАКАЗА', 'СУММА', '', 'Саша', 'Миша', 'Дима РОР', '', 'Выплаты', 'Дата'],
  ['0687-2', '143 940', '', '30 000', '31 000', '7 197', '', '50 000', '01.09'],
  ['0713-2', '72 020', '', '12 000', '', '3 601', '', '', ''],
  ['р.0042', '5 000', '', '3 000', '', '', '', '', ''],
  ['ИТОГО', '215 960', '', '42 000', '31 000', '10 798', '', '', ''],
  ['0800', '10 000', '', 'наличные', '', '', '', '', ''],
])

describe('parseMontageCsv', () => {
  it('берёт монтажников между «Суммой» и «Дима РОР», реестр выплат не трогает', () => {
    const rows = parseMontageCsv(SEP_26)!
    expect(rows.map(r => r.order_no)).toEqual(['0687-2', '0713-2', '0800'])
    expect(rows[0]).toEqual({ order_no: '0687-2', installers: { Саша: 30000, Миша: 31000 }, dima: 7197, unreadable: 0 })
    expect(rows[1].installers).toEqual({ Саша: 12000 })
  })

  it('текст в ячейке монтажника — нечитаемая ячейка, а не ноль', () => {
    const rows = parseMontageCsv(SEP_26)!
    expect(rows[2]).toMatchObject({ installers: {}, unreadable: 1 })
  })

  it('«Дима Монтаж» (декабрь 24) — монтажник, а не РОР', () => {
    const rows = parseMontageCsv(csv([
      ['№ ЗАКАЗА', 'СУММА', '', 'Дима Монтаж', 'Дима РОР'],
      ['0500', '40 000', '', '8 000', '1 200'],
    ]))!
    expect(rows[0]).toMatchObject({ installers: { 'Дима Монтаж': 8000 }, dima: 1200 })
  })

  it('без «Дима РОР» монтажники — до «Выплат»', () => {
    const rows = parseMontageCsv(csv([
      ['№ ЗАКАЗА', 'СУММА', '', 'Саша', '', 'Выплаты'],
      ['0501', '20 000', '', '4 000', '', '9 999'],
    ]))!
    expect(rows[0]).toEqual({ order_no: '0501', installers: { Саша: 4000 }, dima: null, unreadable: 0 })
  })

  it('без шапки «№ заказа» — не вкладка монтажей', () => {
    expect(parseMontageCsv(csv([['Дата', 'Сумма'], ['01.09', '100']]))).toBeNull()
  })
})

describe('collectMontage', () => {
  it('складывает заказ, оплаченный в нескольких месяцах', () => {
    const book = collectMontage([
      { tab: 'Август 26', rows: [{ order_no: '0687-2', installers: { Саша: 20000 }, dima: 3000, unreadable: 0 }] },
      { tab: 'Сентябрь 26', rows: [{ order_no: '0687 - 2', installers: { Саша: 10000, Миша: 31000 }, dima: 4197, unreadable: 0 }] },
    ])
    expect(book.get(orderKey('0687-2'))).toEqual({
      installers: 61000, byName: { Саша: 30000, Миша: 31000 }, dima: 7197, tabs: ['Август 26', 'Сентябрь 26'],
    })
  })
})

describe('checkMontage', () => {
  const book = collectMontage([{ tab: 'Сентябрь 26', rows: parseMontageCsv(SEP_26)! }])
  const one = (installer: number | null, dima: number | null, order_no = '0687-2') =>
    checkMontage([{ order_no, month: '2026-09', installer, dima }], book)[0]

  it('совпало с точностью до рубля', () => {
    expect(one(61000.4, 7197)).toMatchObject({ installerState: 'ok', dimaState: 'ok' })
  })
  it('расходится', () => {
    expect(one(30000, 2079)).toMatchObject({ installerState: 'diff', dimaState: 'diff' })
  })
  it('в «Марже» пусто, в «Монтажах» есть — можно внести; пустой Дима — расхождение', () => {
    expect(one(null, null)).toMatchObject({ installerState: 'fill', dimaState: 'diff' })
  })
  it('заказа нет в «Монтажах» — сверять не с чем', () => {
    expect(one(5000, 100, '0999')).toMatchObject({ montage: null, installerState: 'none', dimaState: 'none' })
  })
})

describe('loadMontageBook', () => {
  it('скрытый месяц читает по имени и отличает «вкладки нет» от подменённого первого листа', async () => {
    const FIRST_SHEET = csv([['№ ЗАКАЗА', 'СУММА', '', 'Старый'], ['0001', '1', '', '1']])
    const htmlview = 'items.push({name: "\\u0424\\u0435\\u0432\\u0440\\u0430\\u043b\\u044c 25", pageUrl: "x", gid: "11"});'
    const fetchText = async (url: string) => {
      if (url.endsWith('/htmlview')) return htmlview
      if (url.includes('gid=11')) return csv([['№ ЗАКАЗА', 'СУММА', '', 'Саша'], ['0200', '9 000', '', '2 000']])
      if (url.includes(encodeURIComponent('Январь 25'))) return csv([['№ ЗАКАЗА', 'СУММА', '', 'Миша'], ['0100', '5 000', '', '1 000']])
      return FIRST_SHEET
    }
    const b = await loadMontageBook(fetchText, '2025-01')
    expect([...b.tabs].sort()).toEqual(['Февраль 25', 'Январь 25'].sort())
    expect(b.missing).toEqual([])
    expect(b.orders.get('0100')?.installers).toBe(1000)
    expect(b.orders.get('0001')).toBeUndefined()
  })
})
