import { describe, it, expect } from 'vitest'
import {
  parseMarginTab, reconcileMonth, summarize, formatMarginReport, needsFix, fromDb,
  type MarginSale, type MarginSyncReport,
} from '@/lib/sales/marginBook'
import * as sheet from '@/lib/sales/salesSheetParse.mjs'

const GID = '203221985'
const HEAD = ['А', 'Сумма заказа', '', 'Предоплата', 'Остаток', 'Дата начала проекта', 'Плановая дата окончания проекта',
  'Стекло', 'Фурнитура', 'Конструктор', 'Замерщик', 'Монтажник', 'Доставка', 'Партнеры', 'Рекламации', 'Налог',
  'Бонус менеджера за проект %', 'Бонус РОР за проект %', 'Бонус РОП за проект %',
  'Итого переменных расходов по сделке', 'Маржинальный доход', 'Рентабельность по МД', 'Дима']
// Строка книги: номер, сумма, 12 статей по порядку шапки, итог переменных, МД, Дима.
const line = (no: string, amount: string, costs: string[], varTotal: string, md: string, dima = '') =>
  [no, amount, '', '', '', '', '', ...costs, varTotal, md, '', dima]
const html = (rows: string[][]) => rows
  .map((cells, i) => `<tr><th id="${GID}R${i}"><div>${i + 1}</div></th>${cells.map(c => `<td class="s1">${c}</td>`).join('')}</tr>`)
  .join('\n')

const BOOK = html([
  HEAD,
  ['', 'р.300 000', ...Array(21).fill('')],
  // 0873-3 — как в «Январе 26»: всё проставлено, итог книги сходится со статьями.
  line('0873-3', 'р.45 000', ['р.4 061', 'р.3 795', 'р.1 000', 'р.2 000', 'р.7 000', 'р.4 000', '', '', 'р.4 950', 'р.900', 'р.675', 'р.450'], 'р.28 831', 'р.16 169', '808'),
  // 0811-2 — как в «Марте 26»: фурнитура «42402» набрана текстом, формула книги её не считает.
  line('0811-2', 'р.150 000', ['р.27 799', '42402', 'р.2 500', 'р.2 500', 'р.26 000', 'р.3 000', '', '', 'р.16 500', 'р.3 000', 'р.2 250', ''], 'р.83 549', 'р.66 451'),
  // 0900-2 — монтажник пуст; «5000» без «р.», но формула его посчитала — это не текст.
  line('0900-2', 'р.105 000', ['р.10 000', '5000', 'р.2 000', 'р.2 500', '', 'р.3 000', 'р.10 500', '', 'р.11 550', 'р.2 100', 'р.1 575', ''], 'р.48 225', 'р.56 775'),
  // 0869-2 — опечатка в номере: в «Продажах» та же сумма под 0959-2.
  line('0869-2', 'р.57 011', ['р.5 000', 'р.5 000', 'р.1 000', 'р.2 000', 'р.5 000', 'р.3 000', '', '', 'р.6 271', 'р.1 140', 'р.855', 'р.570'], 'р.29 836', 'р.27 175'),
  ['', '', ...Array(21).fill('')],
])

const sale = (id: number, order_no: string, amount: number, status: string, partner_fee = 0): MarginSale =>
  ({ id, order_no, client: `Клиент ${id}`, manager: 'Яна', amount, partner_fee, status })
const SALES = [
  sale(1, '0873-3', 45000, 'closed'),
  sale(2, '0811-2', 150000, 'closed'),
  sale(3, '0900-2', 105000, 'closed', 12000),
  sale(4, '0959-2', 57011, 'open'),
]

describe('книга «Маржа»: разбор вкладки', () => {
  const tab = parseMarginTab(BOOK, GID, 'Январь 26')

  it('месяц, строки объектов и итог «Сумма заказа»', () => {
    expect(tab.month).toBe('2026-01')
    expect(tab.rows.map(r => r.order_no)).toEqual(['0873-3', '0811-2', '0900-2', '0869-2'])
    expect(tab.rows.map(r => r.row)).toEqual([3, 4, 5, 6])
    expect(tab.bookAmountTotal).toBe(300000)
  })

  it('пустая ячейка — null («не проставлено»), а не ноль', () => {
    const r = tab.rows.find(x => x.order_no === '0900-2')!
    expect(r.costs.installer).toBeNull()
    expect(r.costs.claims).toBeNull()
    expect(r.costs.hardware).toBe(5000)
  })

  it('число без «р.» — текст, только если формула книги его не посчитала', () => {
    expect(tab.rows.find(x => x.order_no === '0811-2')!.text_cells).toEqual(['hardware'])
    expect(tab.rows.find(x => x.order_no === '0900-2')!.text_cells).toEqual([])
  })

  it('рубли без копеек: расхождение итога в пару рублей — не ошибка', () => {
    const t = parseMarginTab(html([HEAD,
      line('0776-2', 'р.112 340', ['р.10 001', '9999', '', '', '', '', '', '', '', '', '', ''], 'р.20 001', 'р.92 339')]), GID, 'Январь 26')
    expect(t.rows[0].text_cells).toEqual([])
    const [o] = reconcileMonth('2026-01', t.rows, [sale(9, '0776-2', 112340, 'open')])
    expect(o.issues.map(i => i.kind)).not.toContain('book_total')
  })
})

describe('сверка «Маржи» с «Продажами»', () => {
  const tab = parseMarginTab(BOOK, GID, 'Январь 26')
  const objs = reconcileMonth('2026-01', tab.rows, SALES)
  const by = (no: string) => objs.find(o => o.order_no === no)!

  it('всё проставлено и сходится — маржа точная, как в книге', () => {
    const o = by('0873-3')
    expect(o.precise).toBe(true)
    expect(o.md).toBe(16169)
    expect(o.md_pct).toBeCloseTo(35.93, 2)
    expect(o.issues).toEqual([])
  })

  it('статья текстом: маржа из статей, а книге — правка', () => {
    const o = by('0811-2')
    expect(o.md).toBe(150000 - 125951)
    expect(o.precise).toBe(true)
    expect(o.issues).toEqual([{ kind: 'text_cells', keys: ['hardware'], book: 83549, cells: 125951 }])
    expect(needsFix(o, o.issues[0])).toBe(true)
  })

  it('закрыт без монтажника — не точный; партнёрские берутся бо́льшие', () => {
    const o = by('0900-2')
    expect(o.precise).toBe(false)
    expect(o.issues.map(i => i.kind)).toEqual(['missing_costs', 'partners'])
    expect(o.costs!.partners).toBe(12000)
    expect(o.var_total).toBe(48225 + 1500)
    expect(o.md).toBe(105000 - 49725)
  })

  it('себестоимость для витрины CFO: сумма − партнёрские − себестоимость = маржа', () => {
    for (const o of objs.filter(x => x.sale_id != null && x.finance_cost != null)) {
      const s = SALES.find(x => x.id === o.sale_id)!
      expect(o.amount - Number(s.partner_fee) - o.finance_cost!).toBeCloseTo(o.md!, 2)
      expect(o.finance_cost!).toBeGreaterThanOrEqual(0)
    }
  })

  it('номер с опечаткой — подсказка по сумме; открытая продажа без «Маржи» — не правка', () => {
    const lost = by('0869-2')
    expect(lost.issues).toEqual([{ kind: 'no_sale', hint: '0959-2' }])
    const open = by('0959-2')
    expect(open.issues).toEqual([{ kind: 'no_margin' }])
    expect(needsFix(open, open.issues[0])).toBe(false)
    expect(needsFix({ closed: true }, { kind: 'no_margin' })).toBe(true)
  })

  it('доплата с тем же номером — пара по сумме', () => {
    const rows = parseMarginTab(html([HEAD,
      line('0889-4', 'р.13 200', ['р.0', 'р.0', 'р.0', 'р.0', 'р.0', 'р.0', '', '', '', '', '', ''], 'р.0', 'р.13 200'),
      line('0889-4', 'р.80 000', ['р.0', 'р.0', 'р.0', 'р.0', 'р.0', 'р.0', '', '', '', '', '', ''], 'р.0', 'р.80 000')]), GID, 'Июль 26').rows
    const o = reconcileMonth('2026-07', rows, [sale(1, '0889-4', 80000, 'closed'), sale(2, '0889-4', 13200, 'closed')])
    expect(o.map(x => [x.amount, x.sale_id])).toEqual([[13200, 2], [80000, 1]])
    expect(o.every(x => x.precise)).toBe(true)
  })

  it('итоги: заработано — только по точно посчитанным', () => {
    const s = summarize(objs)
    expect(s.closed).toBe(3)
    expect(s.precise).toBe(2)
    expect(s.revenue).toBe(195000)
    expect(s.md).toBe(16169 + 24049)
    expect(s.pending).toEqual({ count: 1, revenue: 105000 })
    expect(s.notInMargin).toBe(1)
    expect(s.dima).toBe(808)
  })

  it('строка базы → строка книги: та же маржа на странице', () => {
    const r = tab.rows[0]
    const db = { row_no: r.row, order_no: r.order_no, amount: r.amount, text_cells: r.text_cells, book_var_total: r.book_var_total, book_md: r.book_md, dima: r.dima, ...r.costs }
    expect(fromDb(db)).toEqual(r)
  })
})

describe('отчёт в Telegram', () => {
  const tab = parseMarginTab(BOOK, GID, 'Январь 26')
  const objects = reconcileMonth('2026-01', tab.rows, SALES)
  const report: MarginSyncReport = {
    dry: false, financeUpdated: 3,
    months: [{ month: '2026-01', tab: 'Январь 26', rows: 4, held: null, bookAmountTotal: 300000, rowsAmount: 357011, summary: summarize(objects), objects }],
  }

  // Рубли печатаются с неразрывным пробелом — сравниваем по обычному.
  const plain = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ')

  it('месяц с правками — ✏️, адрес правки и сводка', () => {
    const t = plain(formatMarginReport(report))
    expect(t).toContain('✏️ Январь: закрыто 3 · посчитано 2')
    expect(t).toContain('«Маржа» Январь 26, стр. 4, 0811-2: текстом набрано — фурнитура')
    expect(t).toContain('может, это 0959-2?')
    expect(t).toContain('у 1 закрытых не проставлены все расходы — 0900-2')
    expect(t).toContain('итог «Сумма заказа» 300 000 ₽, строки складываются в 357 011 ₽')
    expect(t).toContain('Себестоимость в CFO обновлена у 3 продаж')
  })

  it('длинный список режется с хвостом «ещё N»', () => {
    const t = formatMarginReport(report, 700)
    expect(t.length).toBeLessThanOrEqual(760)
    expect(t).toMatch(/…и ещё \d+ — на странице «Маржа»/)
  })

  it('всё сошлось — ✅', () => {
    const clean = reconcileMonth('2026-01', tab.rows.slice(0, 1), SALES.slice(0, 1))
    const t = formatMarginReport({ dry: true, financeUpdated: 0, months: [{ ...report.months[0], bookAmountTotal: 45000, rowsAmount: 45000, objects: clean, summary: summarize(clean) }] })
    expect(t).toContain('✅ Январь: закрыто 1 · посчитано 1')
    expect(t).not.toContain('Поправить')
  })
})

describe('скрытые вкладки «Продаж»: статусы из CSV', () => {
  const parseStatusTab = sheet.parseStatusTab as (csv: string) => { order_no: string; closed: boolean }[] | null
  const parseCsv = sheet.parseCsv as (csv: string) => string[][]

  it('CSV: кавычки, "" и перевод строки внутри поля', () => {
    expect(parseCsv('"a","b ""c""","d\ne"\n"1","2","3"')).toEqual([['a', 'b "c"', 'd\ne'], ['1', '2', '3']])
  })

  it('шапка с «Номер заказа» и «Статус»; «Не закрыт» — не закрыт', () => {
    const csv = '"","","","","","р.6 209 496"\n'
      + '"","","","Отдел","Номер заказа","Клиент","","Менеджер","Статус"\n'
      + '"1","01.06.2026","","Розница","0828-2","Панарин","р.899 500","Александра","Не закрыт"\n'
      + '"2","01.06.2026","","Розница","0004-6","Хныкин","р.86 324","Семён","Закрыт"\n'
      + '"","","","Розница","","","","","Не закрыт"\n'
    expect(parseStatusTab(csv)).toEqual([{ order_no: '0828-2', closed: false }, { order_no: '0004-6', closed: true }])
  })

  it('чужой лист (gviz подменил незнакомое имя первым листом) — null', () => {
    expect(parseStatusTab('"Отметка времени","Вопрос без заголовка"\n"1","2"')).toBeNull()
  })
})
