import { describe, it, expect } from 'vitest'
import {
  parseMarginTab, reconcileMonth, summarize, formatMarginReport, needsFix, fromDb, periodTotals, roundShares,
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

describe('деньги периода: продажи → расходы → маржа', () => {
  const objs = reconcileMonth('2026-01', parseMarginTab(BOOK, GID, 'Январь 26').rows, SALES)

  it('продажи — все заказы; расходы и маржа — закрытые с полными расходами; строка «Маржи» без продажи в суммы не входит', () => {
    const t = periodTotals(objs)
    expect(t.objects).toBe(4)
    expect(t.closed).toBe(2)    // 0900-2 закрыт, но без монтажника — не закрыт
    expect(t.open).toBe(2)      // 0900-2 и открытый 0959-2
    expect(t.to_fill).toBe(1)
    expect(t.sales).toBe(45000 + 150000 + 105000 + 57011)
    expect(t.closed_sales).toBe(195000)
    expect(t.costs).toBe(28831 + 125951)
    expect(Object.values(t.byCost).reduce((a, b) => a + b, 0)).toBe(t.costs)
    expect(t.margin).toBe(16169 + 24049)
    expect(t.margin_pct).toBeCloseTo(40218 / 195000 * 100, 6)
  })

  it('дописали недостающую статью — заказ переходит в закрытые', () => {
    const filled = objs.map(o => (o.order_no === '0900-2' ? { ...o, issues: o.issues.filter(i => i.kind !== 'missing_costs') } : o))
    const t = periodTotals(filled)
    expect(t.closed).toBe(3)
    expect(t.to_fill).toBe(0)
    expect(t.closed_sales).toBe(300000)
    expect(t.costs).toBe(28831 + 125951 + 49725)
  })

  it('открытый заказ с расходами не меняет маржу, пока его не закроют', () => {
    const open = objs.map(o => (o.closed ? o : { ...o, costs: { ...(o.costs ?? {}), glass: 50000 } as typeof o.costs, var_total: 50000, md: o.amount - 50000, issues: [] }))
    const t = periodTotals(open)
    expect(t.costs).toBe(periodTotals(objs).costs)
    expect(t.margin).toBe(periodTotals(objs).margin)
    expect(t.sales).toBe(periodTotals(objs).sales)
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
    expect(t).toContain('✏️ Январь: продажи 357 011 ₽ · закрыто 2 из 4 на 195 000 ₽ · расходы 154 782 ₽ · маржа 20,6 %')
    expect(t).toContain('закрыто, но без всех расходов: 1 — в маржу не вошли, дописать')
    expect(t).toContain('Закрытые объекты с января 2026 (2): продажи 195 000 ₽ · маржа <b>40 218 ₽</b> · 20,6 %')
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

  it('прошлый год — одной строкой, текущий — по месяцам', () => {
    const prev = { ...report.months[0], month: '2025-12', tab: 'Декабрь 25' }
    const t = plain(formatMarginReport({ ...report, months: [prev, report.months[0]] }, 100_000))
    expect(t).toContain('✏️ 2025 год: продажи 357 011 ₽ · закрыто 2 из 4 на 195 000 ₽ · расходы 154 782 ₽ · маржа 20,6 %')
    expect(t).not.toContain('Декабрь:')
    expect(t).toContain('✏️ Январь: продажи 357 011 ₽')
    expect(t).toContain('Закрытые объекты с декабря 2025 (4)')
  })

  it('всё сошлось — ✅', () => {
    const clean = reconcileMonth('2026-01', tab.rows.slice(0, 1), SALES.slice(0, 1))
    const t = formatMarginReport({ dry: true, financeUpdated: 0, months: [{ ...report.months[0], bookAmountTotal: 45000, rowsAmount: 45000, objects: clean, summary: summarize(clean) }] })
    expect(plain(t)).toContain('✅ Январь: продажи 45 000 ₽ · закрыто 1 из 1 на 45 000 ₽ · расходы 28 831 ₽ · маржа 35,9 %')
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

  it('до августа 2025 статус в «Примечании»: над шапкой сводка, «закрыт, зп 07/2» — закрыт', () => {
    const csv = [
      '"","","","","р.139 694","",""',
      '"","","","","","Егор","Айжан"',
      '"","","Отдел","Номер заказа","Клиент","Менеджер","Примечание"',
      '"","","","","р.6 286 249","",""',
      '"1","02.07.2025","Розница","0735-3","Базуев","Айжан","закрыт"',
      '"2","02.07.2025","Розница","0669-2","Вагнер","Александра","закрыт, зп 07/2"',
      '"3","03.07.2025","Розница","0740-3","Иванов","Айжан","ждём остаток"',
      '"4","03.07.2025","Розница","0741-3","Петров","Айжан",""',
      '"","","","р.315 000","","","закрыт"',
    ].join('\n')
    expect(parseStatusTab(csv)).toEqual([
      { order_no: '0735-3', closed: true }, { order_no: '0669-2', closed: true }, { order_no: '0740-3', closed: false },
    ])
  })

  it('есть и «Статус», и «Примечание» — читается «Статус»', () => {
    const csv = '"Номер заказа","Примечание","Статус"\n"0828-2","закрыт по деньгам","в работе"'
    expect(parseStatusTab(csv)).toEqual([{ order_no: '0828-2', closed: false }])
  })
})

describe('roundShares — доли статей сходятся с долей расходов', () => {
  it('январь 2026: статьи в сумме дают 62,3 %, как строка «Расходы по статьям»', () => {
    const parts = [370737, 316393, 312000, 304037, 125030, 88000, 55280, 41462, 36500, 34000, 27639, 12000]
    const whole = 2763980
    const s = roundShares(parts, whole)
    expect(Math.round(s.reduce((a, b) => a + b, 0) * 10) / 10).toBe(62.3)
    parts.forEach((p, i) => expect(Math.abs(s[i] - p / whole * 100)).toBeLessThan(0.1))
  })

  it('без продаж — нули, а не деление на ноль', () => {
    expect(roundShares([100, 200], 0)).toEqual([0, 0])
  })
})

describe('правки «Маржи» из приложения (Вера, 05.10)', () => {
  const tab = parseMarginTab(BOOK, GID, 'Январь 26')
  const at = '2026-10-05T17:00:00Z'
  const ed = (value: number) => ({ value, by: 'Вера', at })

  it('пустая в книге ячейка, внесённая в приложении, закрывает «не внесено» и входит в расходы', () => {
    const before = reconcileMonth('2026-01', tab.rows, SALES).find(o => o.order_no === '0900-2')!
    const o = reconcileMonth('2026-01', tab.rows, SALES, new Map([[3, { installer: ed(9000) }]])).find(x => x.order_no === '0900-2')!
    expect(before.issues.map(i => i.kind)).toContain('missing_costs')
    expect(o.issues.map(i => i.kind)).not.toContain('missing_costs')
    expect(o.var_total).toBe(before.var_total! + 9000)
    expect(o.book_costs!.installer).toBeNull()
    expect(o.edits.installer?.by).toBe('Вера')
  })

  it('правка сильнее книги, а книжное значение остаётся для сравнения', () => {
    const o = reconcileMonth('2026-01', tab.rows, SALES, new Map([[1, { glass: ed(5000) }]])).find(x => x.order_no === '0873-3')!
    expect(o.costs!.glass).toBe(5000)
    expect(o.book_costs!.glass).toBe(4061)
    expect(o.md).toBe(16169 - (5000 - 4061))
  })

  it('объекта нет в книге «Маржа», расходы внесены в приложении — маржа считается по ним', () => {
    const e = { glass: ed(10000), hardware: ed(5000), designer: ed(0), measurer: ed(2000), installer: ed(6000), delivery: ed(3000) }
    const o = reconcileMonth('2026-01', tab.rows, SALES, new Map([[4, e]])).find(x => x.order_no === '0959-2')!
    expect(o.issues.map(i => i.kind)).toEqual([])
    expect(o.var_total).toBe(26000)
    expect(o.md).toBe(57011 - 26000)
    expect(o.finance_cost).toBe(26000)
  })

  it('«закрыт» из приложения — поверх статуса книги продаж; без правки — как в книге', () => {
    const objs = reconcileMonth('2026-01', tab.rows, SALES, new Map([[4, { closed: ed(1) }], [1, { closed: ed(0) }]]))
    const open = objs.find(x => x.order_no === '0959-2')!
    expect([open.closed, open.book_closed]).toEqual([true, false])
    expect(objs.find(x => x.order_no === '0873-3')!.closed).toBe(false)
    expect(objs.find(x => x.order_no === '0811-2')!.closed).toBe(true)
  })
})
