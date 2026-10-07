// Реестр выданных УПД → CSV для книги продаж (этап 8 docs/b2b/ORDER_PANEL_ROUTE.md).
// Файл открывают в Excel у бухгалтера: разделитель «;», дробная часть через запятую, без
// пробелов-разрядов (иначе Excel прочтёт сумму как текст), BOM — чтобы кириллица не съехала.

import { updVatRate } from '@/lib/b2b/updLines'

export type UpdRegistryRow = {
  year: number
  number: number
  doc_date: string
  b2b_order_id: number
  order_number: string | null
  buyer_name: string | null
  buyer_inn: string | null
  buyer_kpp: string | null
  sum_no_vat: number
  vat: number
  sum_inc_vat: number
  issued_at: string
  issued_by_name: string | null
}

export type UpdRegistryTotals = { count: number; sumNoVat: number; vat: number; sumIncVat: number }

const r2 = (n: number) => Math.round(n * 100) / 100

// Суммы в реестре — numeric(14,2): складываем копейками, чтобы итог не поплыл на 0,01.
export function updRegistryTotals(rows: Pick<UpdRegistryRow, 'sum_no_vat' | 'vat' | 'sum_inc_vat'>[]): UpdRegistryTotals {
  let a = 0, b = 0, c = 0
  for (const r of rows) {
    a += Math.round(Number(r.sum_no_vat) * 100)
    b += Math.round(Number(r.vat) * 100)
    c += Math.round(Number(r.sum_inc_vat) * 100)
  }
  return { count: rows.length, sumNoVat: a / 100, vat: b / 100, sumIncVat: c / 100 }
}

const num = (n: number) => r2(Number(n)).toFixed(2).replace('.', ',')
const ruDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

// Кавычки и «;» в названии покупателя (ООО "Ромашка; филиал") ломают колонки. Ведущие = + - @
// Excel исполняет как формулу — такие ячейки предваряем апострофом (минус перед цифрой — число).
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^(?:[=+@\t\r]|-(?!\d))/.test(s)) s = `'${s}`
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const UPD_CSV_HEADER = [
  '№ п/п', 'Код вида операции', 'Номер УПД', 'Дата УПД', 'Покупатель', 'ИНН покупателя', 'КПП покупателя',
  'Ставка НДС, %', 'Стоимость без НДС, ₽', 'НДС, ₽', 'Стоимость с НДС, ₽', 'Заказ',
]

// Одна таблица на обе выгрузки. ИНН и КПП — строки: у одного клиента ИНН начинается с нуля,
// и Excel, прочитав его числом, молча отрезает ноль (в CSV этого не избежать, в .xlsx — можно).
export type UpdRegistryTable = {
  header: string[]
  body: (string | number)[][]
  total: (string | number)[]
}

// Строки — в порядке номера: так их ведёт книга продаж и так видна дыра в серии.
export function updRegistryTable(rows: UpdRegistryRow[]): UpdRegistryTable {
  const sorted = [...rows].sort((a, b) => a.year - b.year || a.number - b.number)
  const body = sorted.map((r, i) => [
    i + 1, '01', r.number, ruDate(r.doc_date), r.buyer_name ?? '', r.buyer_inn ?? '', r.buyer_kpp ?? '',
    updVatRate(r.doc_date), r2(Number(r.sum_no_vat)), r2(Number(r.vat)), r2(Number(r.sum_inc_vat)),
    r.order_number ?? String(r.b2b_order_id),
  ])
  const t = updRegistryTotals(sorted)
  return { header: UPD_CSV_HEADER, body, total: ['Итого', '', t.count, '', '', '', '', '', t.sumNoVat, t.vat, t.sumIncVat, ''] }
}

const MONEY_COLS = new Set([8, 9, 10])

export function updRegistryCsv(rows: UpdRegistryRow[]): string {
  const t = updRegistryTable(rows)
  const line = (cells: (string | number)[]) =>
    cells.map((c, i) => csvCell(MONEY_COLS.has(i) && typeof c === 'number' ? num(c) : c)).join(';')
  return '\uFEFF' + [t.header, ...t.body, t.total].map(line).join('\r\n') + '\r\n'
}

// В .xlsx ИНН и КПП — текстовые ячейки (ведущий ноль не теряется), суммы — числа с копейками.
// Только сервер: библиотека тяжёлая и грузится по требованию.
export async function registryXlsx(rows: UpdRegistryRow[]): Promise<Buffer> {
  const XLSX = await import('xlsx')
  const t = updRegistryTable(rows)
  const ws = XLSX.utils.aoa_to_sheet([t.header, ...t.body, t.total])
  for (let r = 1; r <= t.body.length + 1; r++) {
    for (const c of MONEY_COLS) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.t === 'n') cell.z = '#,##0.00'
    }
  }
  ws['!cols'] = [6, 8, 10, 11, 40, 14, 12, 8, 16, 14, 16, 10].map(wch => ({ wch }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Реестр УПД')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

// Пропуски в серии года: номер от первого в серии до последнего выданного, которого нет в
// реестре. Пропуск — УПД, выписанный мимо приложения, или повод разобраться до сдачи книги.
export function updSeriesGaps(startNumber: number, numbers: number[]): number[] {
  if (!numbers.length) return []
  const set = new Set(numbers)
  const max = Math.max(...numbers)
  const out: number[] = []
  for (let n = startNumber; n < max && out.length < 50; n++) if (!set.has(n)) out.push(n)
  return out
}
