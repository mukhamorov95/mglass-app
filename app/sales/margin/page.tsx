import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { mskDayKey } from '@/lib/time'
import { shiftMonth } from '@/lib/sales/period'
import {
  COST_RU, MARGIN_SINCE, SALE_COLUMNS, fixLine, fromDb, monthRu, needsFix, reconcileMonth, summarize,
  type CostKey, type MarginDbRow, type MarginObject, type MarginSale,
} from '@/lib/sales/marginBook'

// Маржа объектов M-Glass: книга «Маржа», сверенная с «Продажами M-Glass».
// Только владельцу — решение «маржа продаж — пока вижу только я». Витрина CFO
// /cfo/sales-ledger читает ту же себестоимость: её пишет та же утренняя сверка.

export const dynamic = 'force-dynamic'

type Mode = 'month' | 'quarter' | 'year'
type Filter = 'all' | 'precise' | 'pending' | 'open' | 'fix'
type Sale = MarginSale & { ledger_month: string }

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'precise', label: 'Посчитаны точно' },
  { key: 'pending', label: 'Закрыты, не посчитаны' },
  { key: 'open', label: 'В работе' },
  { key: 'fix', label: 'Поправить' },
]
const COLS: { keys: CostKey[]; label: string }[] = [
  { keys: ['glass'], label: 'Стекло' },
  { keys: ['hardware'], label: 'Фурн.' },
  { keys: ['designer'], label: 'Констр.' },
  { keys: ['measurer'], label: 'Замер' },
  { keys: ['installer'], label: 'Монтаж' },
  { keys: ['delivery'], label: 'Дост.' },
  { keys: ['partners'], label: 'Партн.' },
  { keys: ['claims'], label: 'Реклам.' },
  { keys: ['tax', 'bonus_manager', 'bonus_ror', 'bonus_rop'], label: 'Налог, бонусы' },
]

const rub = (n: number) => Math.round(n).toLocaleString('ru-RU')
const pct1 = (n: number) => Math.round(n * 10) / 10
const pct = (n: number | null) => (n == null ? '—' : `${pct1(n).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`)
// Цвет — по тому значению, что напечатано: 34,96 % показывается «35,0 %» и красится зелёным.
const mdCls = (n: number | null) =>
  n == null ? 'text-[#9a9a95]' : pct1(n) < 25 ? 'text-red-600' : pct1(n) < 35 ? 'text-amber-600' : 'text-emerald-700'

function monthsOf(mode: Mode, anchor: string): string[] {
  const [y, m] = anchor.split('-').map(Number)
  if (mode === 'month') return [anchor]
  const first = mode === 'year' ? 1 : Math.floor((m - 1) / 3) * 3 + 1
  const n = mode === 'year' ? 12 : 3
  return Array.from({ length: n }, (_, i) => `${y}-${String(first + i).padStart(2, '0')}`)
}
const periodLabel = (mode: Mode, anchor: string) => {
  const y = anchor.slice(0, 4)
  if (mode === 'year') return `${y} год`
  if (mode === 'quarter') return `${Math.floor((Number(anchor.slice(5, 7)) - 1) / 3) + 1} квартал ${y}`
  return `${monthRu(anchor)} ${y}`
}
const step = (mode: Mode) => (mode === 'year' ? 12 : mode === 'quarter' ? 3 : 1)

const matches = (o: MarginObject, f: Filter) =>
  f === 'all' ? true
  : f === 'precise' ? o.precise
  : f === 'pending' ? o.closed && !o.precise
  : f === 'open' ? !o.closed
  : o.issues.some(i => needsFix(o, i))

export default async function MarginPage({ searchParams }: { searchParams: Promise<{ mode?: string; month?: string; f?: string }> }) {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo') redirect('/sales')

  const sp = await searchParams
  const mode: Mode = sp.mode === 'month' || sp.mode === 'quarter' ? sp.mode : 'year'
  const today = mskDayKey().slice(0, 7)
  const anchor = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : today
  const filter: Filter = FILTERS.some(x => x.key === sp.f) ? (sp.f as Filter) : 'all'
  const months = monthsOf(mode, anchor)
  const href = (p: { mode?: Mode; month?: string; f?: Filter }) => {
    const q = new URLSearchParams({ mode: p.mode ?? mode, month: p.month ?? anchor })
    const f = p.f ?? filter
    if (f !== 'all') q.set('f', f)
    return `/sales/margin?${q}`
  }

  // Service-role: роль проверена выше; RLS маржи пустила бы и так, но продажи
  // всех менеджеров — только владельцу, а это и есть он.
  const svc = createServiceClient()
  const [{ data: rowsData }, { data: salesData }] = await Promise.all([
    svc.from('margin_book_rows').select('*').in('ledger_month', months).eq('voided', false).order('row_no').range(0, 4999),
    svc.from('crm_sales').select(SALE_COLUMNS).in('ledger_month', months).eq('voided', false).neq('department', 'b2b').range(0, 4999),
  ])
  const rows = (rowsData ?? []) as (MarginDbRow & { ledger_month: string; tab: string })[]
  const sales = (salesData ?? []) as unknown as Sale[]
  const byMonth = months.map(m => {
    const own = rows.filter(r => r.ledger_month === m)
    return {
      month: m, tab: own[0]?.tab ?? `${monthRu(m)} ${m.slice(2, 4)}`,
      objects: reconcileMonth(m, own.map(fromDb), sales.filter(s => s.ledger_month === m)),
    }
  }).filter(x => x.objects.length > 0)
  const objects = byMonth.flatMap(x => x.objects)
  const s = summarize(objects)
  const fixes = byMonth.flatMap(m => m.objects.flatMap(o => o.issues.filter(i => needsFix(o, i)).map(i => fixLine(m, o, i))))
  const shown = byMonth.map(m => ({ ...m, objects: m.objects.filter(o => matches(o, filter)) })).filter(m => m.objects.length)
  const dimaSum = s.dima
  const beforeBook = months[0] < MARGIN_SINCE

  const tile = 'bg-white border border-[#e4e4e0] rounded-xl px-4 py-3'
  const btn = (on: boolean) => `px-3 py-1.5 rounded-lg text-[12px] font-medium border ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`

  return (
    <div className="min-h-screen bg-[#f8f8f7] pb-20">
      <div className="max-w-[1280px] mx-auto px-4 py-5">
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <h1 className="text-[18px] font-semibold text-[#111110]">📐 Маржа</h1>
          <Link href="/sales" className="text-[12px] text-[#0071e3] hover:underline">→ Продажи M-Glass</Link>
          <Link href="/sales/managers" className="text-[12px] text-[#0071e3] hover:underline">→ Показатели менеджеров</Link>
        </div>
        <p className="text-[12px] text-[#9a9a95] mb-3">Книга «Маржа», сверенная с «Продажами M-Glass». Каждое утро в 8:10 — после сверки продаж.</p>

        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="flex items-center gap-1.5">
            <Link href={href({ month: shiftMonth(anchor, -step(mode)) })} className="w-8 h-8 grid place-items-center rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:bg-[#f5f5f3]">‹</Link>
            <span className="text-[13px] font-semibold text-[#111110] min-w-[150px] text-center">{periodLabel(mode, anchor)}</span>
            <Link href={href({ month: shiftMonth(anchor, step(mode)) })} className="w-8 h-8 grid place-items-center rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:bg-[#f5f5f3]">›</Link>
          </div>
          <Link href={href({ mode: 'month' })} className={btn(mode === 'month')}>Месяц</Link>
          <Link href={href({ mode: 'quarter' })} className={btn(mode === 'quarter')}>Квартал</Link>
          <Link href={href({ mode: 'year' })} className={btn(mode === 'year')}>Год</Link>
        </div>

        {beforeBook && (
          <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            Книга «Маржа» сверяется с {monthRu(MARGIN_SINCE).toLowerCase()} {MARGIN_SINCE.slice(0, 4)} года — раньше объектов в ней здесь нет.
          </p>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Заработано · посчитано точно</p>
            <p className="text-[20px] font-semibold text-[#111110] mt-0.5">{rub(s.md)} ₽</p>
            <p className="text-[12px] text-[#6b6b66]">
              <span className={`font-semibold ${mdCls(s.md_pct)}`}>{pct(s.md_pct)}</span> от выручки {rub(s.revenue)} ₽ · {s.precise} из {s.closed} закрытых
            </p>
          </div>
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Закрыты, посчитать нельзя</p>
            <p className="text-[20px] font-semibold text-[#111110] mt-0.5">{s.pending.count}</p>
            <p className="text-[12px] text-[#6b6b66]">на {rub(s.pending.revenue)} ₽ — не все расходы, суммы не сходятся или нет в «Марже»</p>
          </div>
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">В работе · предварительно</p>
            <p className="text-[20px] font-semibold text-[#111110] mt-0.5">{rub(s.open.md)} ₽</p>
            <p className="text-[12px] text-[#6b6b66]">
              <span className={mdCls(s.open.revenue ? s.open.md / s.open.revenue * 100 : null)}>{pct(s.open.revenue ? s.open.md / s.open.revenue * 100 : null)}</span> · {s.open.count} объектов на {rub(s.open.revenue)} ₽
              {s.notInMargin > 0 && ` · ещё ${s.notInMargin} не внесены в «Маржу»`}
            </p>
          </div>
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Поправить в книгах</p>
            <p className={`text-[20px] font-semibold mt-0.5 ${fixes.length ? 'text-amber-600' : 'text-emerald-700'}`}>{fixes.length}</p>
            <p className="text-[12px] text-[#6b6b66]">{fixes.length ? 'список — внизу страницы' : 'книги сходятся'}</p>
          </div>
        </div>

        {mode !== 'month' && byMonth.length > 0 && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto mb-4">
            <table className="w-full text-[12px]">
              <thead className="text-[#9a9a95] text-left">
                <tr className="border-b border-[#e4e4e0]">
                  <th className="px-3 py-2 font-medium">Месяц</th>
                  <th className="px-3 py-2 font-medium text-right">Объектов</th>
                  <th className="px-3 py-2 font-medium text-right">Закрыто</th>
                  <th className="px-3 py-2 font-medium text-right">Посчитано</th>
                  <th className="px-3 py-2 font-medium text-right">Выручка посчитанных</th>
                  <th className="px-3 py-2 font-medium text-right">Заработано</th>
                  <th className="px-3 py-2 font-medium text-right">МД</th>
                  <th className="px-3 py-2 font-medium text-right">В работе, предв.</th>
                </tr>
              </thead>
              <tbody>
                {byMonth.map(m => {
                  const ms = summarize(m.objects)
                  return (
                    <tr key={m.month} className="border-b border-[#f0f0ec] last:border-0">
                      <td className="px-3 py-2"><Link href={href({ mode: 'month', month: m.month })} className="text-[#0071e3] hover:underline">{monthRu(m.month)}</Link></td>
                      <td className="px-3 py-2 text-right">{ms.objects}</td>
                      <td className="px-3 py-2 text-right">{ms.closed}</td>
                      <td className="px-3 py-2 text-right">{ms.precise}</td>
                      <td className="px-3 py-2 text-right">{rub(ms.revenue)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{rub(ms.md)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${mdCls(ms.md_pct)}`}>{pct(ms.md_pct)}</td>
                      <td className="px-3 py-2 text-right text-[#6b6b66]">{ms.open.count ? `${rub(ms.open.md)} · ${pct(ms.open.revenue ? ms.open.md / ms.open.revenue * 100 : null)}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {FILTERS.map(x => <Link key={x.key} href={href({ f: x.key })} className={btn(filter === x.key)}>{x.label} · {objects.filter(o => matches(o, x.key)).length}</Link>)}
        </div>

        {shown.length === 0 && <p className="text-[13px] text-[#9a9a95] py-6 text-center">За этот период объектов нет.</p>}
        {shown.map(m => (
          <div key={m.month} className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto mb-4">
            <p className="px-3 pt-3 pb-1 text-[13px] font-semibold text-[#111110]">{monthRu(m.month)} {m.month.slice(0, 4)}</p>
            <table className="w-full text-[12px] whitespace-nowrap">
              <thead className="text-[#9a9a95] text-left">
                <tr className="border-b border-[#e4e4e0]">
                  <th className="px-3 py-2 font-medium">Заказ</th>
                  <th className="px-3 py-2 font-medium">Клиент · менеджер</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                  <th className="px-3 py-2 font-medium text-right">Сумма</th>
                  {COLS.map(c => <th key={c.label} className="px-2 py-2 font-medium text-right">{c.label}</th>)}
                  <th className="px-3 py-2 font-medium text-right">Расходы</th>
                  <th className="px-3 py-2 font-medium text-right">Заработано</th>
                  <th className="px-3 py-2 font-medium text-right">МД</th>
                  <th className="px-3 py-2 font-medium">Что не так</th>
                </tr>
              </thead>
              <tbody>
                {m.objects.map(o => {
                  const missing = new Set(o.issues.flatMap(i => (i.kind === 'missing_costs' ? i.keys : [])))
                  return (
                    <tr key={`${o.order_no}-${o.row ?? o.sale_id}`} className="border-b border-[#f0f0ec] last:border-0 align-top">
                      <td className="px-3 py-2 font-medium text-[#111110]">{o.order_no ?? '—'}{o.row && <span className="text-[#c4c4be] font-normal"> · стр. {o.row}</span>}</td>
                      <td className="px-3 py-2 max-w-[220px] truncate" title={o.client ?? ''}>{o.client ?? '—'}<span className="text-[#9a9a95]"> · {o.manager ?? '—'}</span></td>
                      <td className="px-3 py-2">
                        {o.precise ? <span className="text-emerald-700">✓ посчитан</span>
                          : o.closed ? <span className="text-amber-600">закрыт</span>
                          : <span className="text-[#9a9a95]">в работе</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{rub(o.amount)}</td>
                      {COLS.map(c => {
                        if (!o.costs) return <td key={c.label} className="px-2 py-2 text-right text-[#c4c4be]">·</td>
                        const vals = c.keys.map(k => o.costs![k])
                        const empty = vals.every(v => v == null)
                        const miss = c.keys.some(k => missing.has(k))
                        return (
                          <td key={c.label} className={`px-2 py-2 text-right ${miss && o.closed ? 'bg-amber-50 text-amber-700' : empty ? 'text-[#c4c4be]' : ''}`}>
                            {empty ? (miss && o.closed ? 'нет' : '·') : rub(vals.reduce<number>((a, v) => a + (v ?? 0), 0))}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-right">{o.var_total == null ? '—' : rub(o.var_total)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{o.md == null ? '—' : rub(o.md)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${mdCls(o.md_pct)}`}>{pct(o.md_pct)}</td>
                      <td className="px-3 py-2 text-[#6b6b66] whitespace-normal min-w-[220px]">{issueText(o)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}

        {fixes.length > 0 && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 mb-4">
            <p className="text-[13px] font-semibold text-[#111110] mb-2">✏️ Поправить в книгах · {fixes.length}</p>
            <ul className="space-y-1 text-[12px] text-[#3a3a37]">
              {fixes.map((f, i) => <li key={i}>• {f.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')}</li>)}
            </ul>
          </div>
        )}

        <div className="text-[11px] text-[#9a9a95] space-y-1">
          <p>Заработано (маржинальный доход) = сумма продажи − все переменные расходы: стекло, фурнитура, конструктор, замерщик, монтажник, доставка, партнёры, рекламации, налог и бонусы. Статьи складываются здесь, а не берутся из итога книги: число, набранное текстом, книга не считает.</p>
          <p>«Посчитан точно» — объект закрыт в «Продажах», есть в «Марже», суммы совпадают и проставлены стекло, фурнитура, конструктор, замерщик, монтажник и доставка. Если расхода не было — поставьте 0, пустая ячейка значит «не проставлено».</p>
          {dimaSum > 0 && <p>Дмитрию (5 % от МД, колонка «Дима» в книге) по посчитанным объектам — {rub(dimaSum)} ₽; в расходы не входит, как и в книге.</p>}
        </div>
      </div>
    </div>
  )
}

function issueText(o: MarginObject): string {
  const parts: string[] = []
  for (const i of o.issues) {
    if (i.kind === 'no_sale') parts.push(`нет в «Продажах»${i.hint ? ` (может, ${i.hint}?)` : ''}`)
    if (i.kind === 'no_margin') parts.push(o.closed ? 'нет в «Марже»' : 'ещё не в «Марже»')
    if (i.kind === 'amount') parts.push(`в «Марже» сумма ${rub(i.margin)}`)
    if (i.kind === 'text_cells') parts.push(`текстом: ${i.keys.map(k => COST_RU[k]).join(', ')} — книга занизила расходы на ${rub(i.cells - i.book)}`)
    if (i.kind === 'book_total') parts.push(`итог книги ${rub(i.book)} ≠ статьям`)
    if (i.kind === 'missing_costs' && o.closed) parts.push(`не проставлено: ${i.keys.map(k => COST_RU[k]).join(', ')}`)
    if (i.kind === 'partners') parts.push(i.sale > i.margin ? `партнёрские в «Продажах» ${rub(i.sale)}, в «Марже» ${rub(i.margin)}` : `в «Продажах» партнёрские ${rub(i.sale)}`)
  }
  return parts.join('; ') || '—'
}
