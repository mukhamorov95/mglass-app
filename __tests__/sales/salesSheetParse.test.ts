import { describe, it, expect } from 'vitest'
import * as sheet from '@/scripts/lib/salesSheetParse.mjs'

// Модуль разбора книги — на JS (его запускает скрипт импорта), поэтому в тесте
// поля описываем сами: иначе TS выводит из JSDoc пустые объекты.
type Cols = Record<string, number>
type Sale = Record<string, unknown>
const { parseTabMonth, parseMoney, parseDate, paidFromColor, parseSheetRows, rowToSale, parseTabList } = sheet
const findColumns = sheet.findColumns as (rows: unknown[]) => { headerRow: number; cols: Cols }
const parseTab = sheet.parseTab as (html: string, gid: string, tab: string) =>
  { ledgerMonth: string; headerRow: number; sales: Sale[]; skipped: Sale[] }

describe('книга продаж: разбор значений', () => {
  it('вкладка → месяц леджера', () => {
    expect(parseTabMonth('Июль 26')).toBe('2026-07')
    expect(parseTabMonth('Октябрь 26 ')).toBe('2026-10')
    expect(parseTabMonth('Декабрь 2025')).toBe('2025-12')
    expect(parseTabMonth('ОБЩИЙ')).toBeNull()
    expect(parseTabMonth('ПРОИЗВОДСТВО')).toBeNull()
  })

  it('деньги: пусто ≠ ноль', () => {
    expect(parseMoney('р.186 500')).toBe(186500)
    expect(parseMoney('р.0')).toBe(0)
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('-')).toBeNull()
  })

  it('дата: 1900 год — пустая ячейка с формулой, 31 сентября — опечатка в книге', () => {
    expect(parseDate('02.07.2026')).toBe('2026-07-02')
    expect(parseDate('17.01.1900')).toBeNull()
    expect(parseDate('31.09.2026')).toBeNull()
    expect(parseDate('30.09.2026')).toBe('2026-09-30')
    expect(parseDate('')).toBeNull()
  })

  it('оплачено определяется зелёным, белое и красное — нет', () => {
    expect(paidFromColor('#d9ead3')).toBe(true)
    expect(paidFromColor('#b6d7a8')).toBe(true)
    expect(paidFromColor('#00ff00')).toBe(true)
    expect(paidFromColor('#ffffff')).toBe(false)
    expect(paidFromColor('#ea9999')).toBe(false)
    expect(paidFromColor('#f4cccc')).toBe(false)
    expect(paidFromColor(null)).toBe(false)
  })
})

// Кусок настоящей разметки htmlview: шапка + две строки (одна закрытая).
const GID = '1983399733'
const HTML = `
<style>.s30{background-color:#ffffff;}.s36{background-color:#d9ead3;}.s37{background-color:#ffffff;}.s41{background-color:#b6d7a8;}</style>
<table>
<tr><th id="${GID}R3"><div>4</div></th><td class="s30">#</td><td class="s30">Дата</td><td class="s30">Дата готовности</td><td class="s30">Отдел</td><td class="s30">Номер заказа</td><td class="s30">Клиент</td><td class="s30">Сумма заказа</td><td class="s30">Партнёрские</td><td class="s30">ПРЕДОПЛАТА</td><td class="s30">ОСТАТОК</td><td class="s30">Способ оплаты </td><td class="s30">Менеджер</td><td class="s30">Статус</td></tr>
<tr><th id="${GID}R5"><div>6</div></th><td class="s30">1</td><td class="s30">02.07.2026</td><td class="s30">20.07.2026</td><td class="s30"><span class="s33">Розница</span></td><td class="s30">0935-3</td><td class="s30"> Преображенцева Анастасия Юрьевна</td><td class="s30">р.186&nbsp;500</td><td class="s30">р.18&nbsp;650</td><td class="s36">р.130&nbsp;550</td><td class="s37">р.55&nbsp;950</td><td class="s30">Счёт</td><td class="s30">Айжан</td><td class="s30"><span class="s33">Не закрыт</span></td></tr>
<tr><th id="${GID}R6"><div>7</div></th><td class="s30">2</td><td class="s30">02.07.2026</td><td class="s30">20.07.2026</td><td class="s30"><span class="s33">Розница</span></td><td class="s30">0929-3</td><td class="s30">ООО &quot;ГЕРМЕС СТРОЙТЕХНИКА&quot;</td><td class="s30">р.77&nbsp;000</td><td class="s30"></td><td class="s36">р.53&nbsp;900</td><td class="s41">р.23&nbsp;100</td><td class="s30">Наличные</td><td class="s30">Айжан </td><td class="s30"><span class="s33">Закрыт</span></td></tr>
<tr><th id="${GID}R7"><div>8</div></th><td class="s30"></td><td class="s30"></td><td class="s30">17.01.1900</td><td class="s30">Розница</td><td class="s30"></td><td class="s30"></td><td class="s30"></td><td class="s30"></td><td class="s30">р.0</td><td class="s30">р.0</td><td class="s30"></td><td class="s30"></td><td class="s30">Не закрыт</td></tr>
</table>`

describe('книга продаж: разбор строк', () => {
  it('колонки находятся по подписям, а не по номерам', () => {
    const rows = parseSheetRows(HTML, GID)
    const f = findColumns(rows)
    expect(f.headerRow).toBe(4)
    expect(f.cols.amount).toBe(6)
    expect(f.cols.prepayment).toBe(8)
    expect(f.cols.status).toBe(12)
  })

  it('строка книги превращается в продажу, ключ — номер строки листа', () => {
    const { sales, ledgerMonth } = parseTab(HTML, GID, 'Июль 26')
    expect(ledgerMonth).toBe('2026-07')
    expect(sales).toHaveLength(2)
    expect(sales[0]).toMatchObject({
      external_key: 'gsheet:Июль 26:6', sale_date: '2026-07-02', ready_date: '2026-07-20',
      order_no: '0935-3', client: 'Преображенцева Анастасия Юрьевна', amount: 186500,
      partner_fee: 18650, prepayment: 130550, prepayment_paid: true, remainder_paid: false,
      payment_method: 'Счёт', manager: 'Айжан', status: 'open', department: 'mglass', needs_review: false,
    })
  })

  it('закрытая продажа: остаток зелёный, имя менеджера без хвостового пробела', () => {
    const { sales } = parseTab(HTML, GID, 'Июль 26')
    expect(sales[1]).toMatchObject({
      external_key: 'gsheet:Июль 26:7', status: 'closed', remainder_paid: true,
      manager: 'Айжан', payment_method: 'Наличные', partner_fee: 0,
    })
  })

  it('склеенная по ширине ячейка не сдвигает строку', () => {
    // «class="s32 softmerge"» — так книга рисует длинное имя клиента. Если
    // требовать один класс, ячейка выпадает и клиент уезжает в сумму.
    const merged = HTML.replace('<td class="s30"> Преображенцева Анастасия Юрьевна</td>',
      '<td class="s32 softmerge"><div class="softmerge-inner">ООО &quot;КЛУБ ОХОТНИКОВ&quot;</div></td>')
    const { sales } = parseTab(merged, GID, 'Июль 26')
    expect(sales[0].client).toBe('ООО "КЛУБ ОХОТНИКОВ"')
    expect(sales[0].amount).toBe(186500)
  })

  it('строка без «Суммы заказа» — это доплата: в продажи не идёт, но видна отдельно', () => {
    const dopl = HTML.replace('<td class="s30">р.186&nbsp;500</td>', '<td class="s30"></td>')
    const { sales, skipped } = parseTab(dopl, GID, 'Июль 26')
    expect(sales).toHaveLength(1)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toMatchObject({ skip: 'без суммы заказа', order_no: '0935-3', prepayment: 130550 })
  })

  it('пустая заготовка строки продажей не становится', () => {
    const rows = parseSheetRows(HTML, GID)
    const { cols } = findColumns(rows)
    const empty = rows.find(r => r.row === 8)
    expect(rowToSale(empty, cols, 'Июль 26', '2026-07')).toBeNull()
  })

  it('без даты продажи месяц берётся по вкладке и строка помечается на проверку', () => {
    const rows = parseSheetRows(HTML, GID)
    const { cols } = findColumns(rows)
    const r = JSON.parse(JSON.stringify(rows.find(x => x.row === 6)))
    r.cells[cols.date].text = ''
    const s = rowToSale(r, cols, 'Август 26', '2026-08') as Sale
    expect(s).toMatchObject({ sale_date: '2026-08-01', needs_review: true })
  })

  it('список вкладок читается с именами и gid', () => {
    const menu = 'items.push({name: "Июль 26", pageUrl: "x", gid: "1983399733",initialSheet: true});items.push({name: "Август 26", pageUrl: "y", gid: "215412157",initialSheet: false});'
    expect(parseTabList(menu)).toEqual([
      { name: 'Июль 26', gid: '1983399733' },
      { name: 'Август 26', gid: '215412157' },
    ])
  })
})
