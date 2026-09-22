import { describe, it, expect } from 'vitest'
import * as dds from '@/scripts/lib/ddsBookParse.mjs'

type Fund = { id: number; name: string; fund_class: string; sort: number }
type Sub = { id: number; fund_id: number; name: string }
type Entry = { entry_date: string; kind: string; fund_id: number; subfund_id: number | null; amount: number }
type Line = { ri: number; fund: Fund; sub: Sub | null }
const buildLayout = dds.buildLayout as (rows: string[][], funds: Fund[], subs: Sub[]) => { layout: Line[]; unknown: string[] }
const collectEntries = dds.collectEntries as (a: { unit: string; rows: string[][]; cols: { i: number; date: string }[]; layout: Line[] }) => {
  entries: Entry[]
  skipped: { date: string; fund: string; neighbour: string; amount: number }[]
  warnings: { date: string; amount: number; neighbourBlock: number }[]
}
const dateColumns = dds.dateColumns as (h: string[]) => { i: number; date: string }[]

// Справочник ИП в том же порядке, что в базе (cashflow_funds.sort)
const FUNDS: Fund[] = [
  { id: 12, name: 'Реклама и продвижение', fund_class: 'fixed', sort: 11 },
  { id: 13, name: 'Партнерские', fund_class: 'fixed', sort: 12 },
  { id: 14, name: 'Фонд аренды', fund_class: 'fixed', sort: 13 },
]
const SUBS: Sub[] = [
  { id: 56, fund_id: 12, name: 'Реклама' },
  { id: 57, fund_id: 12, name: 'Директолог Дмитрий' },
  { id: 58, fund_id: 12, name: 'Поливной Сергей подрядчик' },
  { id: 59, fund_id: 13, name: 'Саксонов Сергей контекстолог' },
  { id: 60, fund_id: 13, name: 'СММ' },
  { id: 61, fund_id: 14, name: 'аренда' },
]

// Строки листа «ИП ДДС» на реальных днях книги. Колонка C — итог строки фонда.
const DAYS = ['15.05', '10.04', '25.06', '26.06', '03.10']
function sheet(values: Record<string, number[]>) {
  const row = (name: string, total = '') => [name, '', total, '', ...(values[name] ?? DAYS.map(() => 0)).map(v => (v ? String(v) : ''))]
  return [
    ['', '', '', '', ...DAYS],
    row('Реклама и продвижение', '2393465'), row('Реклама'), row('Директолог Дмитрий'), row('Поливной Сергей подрядчик'),
    row('Партнерские', '2946881'), row('Саксонов Сергей контекстолог'), row('СММ'),
    row('Фонд аренды', '845484'), row('аренда'),
  ]
}
//                                     15.05.25  10.04.26  25.06.26  26.06.26  03.10.25
const BOOK = sheet({
  'Реклама и продвижение':           [48000,    85000,    27990,    126150,   125526],
  'Реклама':                         [16500,    32500,    0,        0,        10000],
  'Партнерские':                     [0,        52500,    2990,     126150,   105526],
  'СММ':                             [0,        0,        25000,    0,        10000],
  'аренда':                          [0,        0,        0,        0,        0],
})

function run(rows = BOOK) {
  const { layout } = buildLayout(rows, FUNDS, SUBS)
  // колонки в тестовом листе идут не по порядку дат — год проставляем руками
  const cols = dateColumns(rows[0]).map((c, k) => ({ i: c.i, date: ['2025-05-15', '2026-04-10', '2026-06-25', '2026-06-26', '2025-10-03'][k] }))
  return collectEntries({ unit: 'ip', rows, cols, layout })
}
const onDay = (entries: Entry[], date: string, fund: number) => entries.filter(e => e.entry_date === date && e.fund_id === fund)
const total = (entries: Entry[]) => entries.reduce((s, e) => s + e.amount, 0)

describe('книга ДДС: итог «Реклама и продвижение» захватывает «Партнерские»', () => {
  it('10.04.2026: итог 85 000 = «Реклама» 32 500 + «Партнерские» 52 500 — на фонд рекламы только подстрока', () => {
    const { entries, skipped } = run()
    expect(onDay(entries, '2026-04-10', 12)).toEqual([expect.objectContaining({ subfund_id: 56, amount: 32500 })])
    expect(onDay(entries, '2026-04-10', 13)).toEqual([expect.objectContaining({ subfund_id: null, amount: 52500 })])
    expect(skipped).toContainEqual({ date: '2026-04-10', fund: 'Реклама и продвижение', neighbour: 'Партнерские', amount: 52500 })
  })

  it('26.06.2026: итог 126 150 = «Партнерские» 126 150 — на фонд рекламы ничего', () => {
    const { entries } = run()
    expect(onDay(entries, '2026-06-26', 12)).toEqual([])
    expect(total(onDay(entries, '2026-06-26', 13))).toBe(126150)
  })

  it('деньги дня равны итогу книги: ни задвоения, ни потери', () => {
    const { entries } = run()
    for (const [date, bookTotal] of [['2026-04-10', 85000], ['2026-06-25', 27990], ['2026-06-26', 126150], ['2025-10-03', 125526]] as const) {
      const day = entries.filter(e => e.entry_date === date && (e.fund_id === 12 || e.fund_id === 13))
      expect(total(day), date).toBe(bookTotal)
    }
  })

  it('до формулы (05.2025) итог фонда — прямой ввод: разница с подстроками остаётся записью на фонд', () => {
    const { entries, skipped } = run()
    expect(onDay(entries, '2025-05-15', 12)).toEqual(expect.arrayContaining([
      expect.objectContaining({ subfund_id: 56, amount: 16500 }),
      expect.objectContaining({ subfund_id: null, amount: 31500 }),
    ]))
    expect(skipped.some(s => s.date === '2025-05-15')).toBe(false)
  })
})

describe('«Партнерские»: строка фонда — свой ввод, «СММ» прибавляется, а не вычитается', () => {
  it('03.10.2025: «Партнерские» 105 526 + «СММ» 10 000', () => {
    const { entries } = run()
    const day = onDay(entries, '2025-10-03', 13)
    expect(day).toEqual(expect.arrayContaining([
      expect.objectContaining({ subfund_id: null, amount: 105526 }),
      expect.objectContaining({ subfund_id: 60, amount: 10000 }),
    ]))
    expect(total(day)).toBe(115526)
  })

  it('25.06.2026: «Партнерские» 2 990 меньше «СММ» 25 000 — всё равно записаны оба', () => {
    const { entries } = run()
    expect(total(onDay(entries, '2026-06-25', 13))).toBe(27990)
    expect(onDay(entries, '2026-06-25', 13)).toContainEqual(expect.objectContaining({ subfund_id: null, amount: 2990 }))
  })
})

describe('захват соседа распознаётся только по точному совпадению', () => {
  it('разница больше блока соседа — запись остаётся, но с предупреждением', () => {
    const rows = BOOK.map(r => [...r])
    rows[1][5] = '100000'   // 10.04: итог 100 000 при «Реклама» 32 500 и «Партнерских» 52 500
    const { entries, warnings } = run(rows)
    expect(onDay(entries, '2026-04-10', 12)).toContainEqual(expect.objectContaining({ subfund_id: null, amount: 67500 }))
    expect(warnings).toContainEqual(expect.objectContaining({ date: '2026-04-10', amount: 67500, neighbourBlock: 52500 }))
  })
})
