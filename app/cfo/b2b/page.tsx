import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

// B2B-аналитика: оборотка по годам и месяцам + разбивка себестоимости
// (материал / закалка / прочее) + прибыль. Оборотка — по всем заказам;
// разбивка себестоимости — только по заказам с items (сделаны через калькулятор).
// Импортированные из таблицы заказы items не имеют → доли показываются с покрытием.
// archived_at IS NULL — иначе суммируются архивные прогоны импорта (оборотка утроится).

export const dynamic = 'force-dynamic'

type OrderRow = {
  id: number
  created_at: string
  client_name: string | null
  total_after_discount: number | null
  total_sale_inc_vat: number | null
  notes: string | null
  items: unknown
}

const DRAFT = new Set(['quote', 'pending_approval', 'rejected'])
const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

function parseNotes(n: string | null): { status?: string } {
  if (!n) return {}
  if (typeof n === 'object') return n as { status?: string }
  try { const p = JSON.parse(n); return typeof p === 'object' && p ? p : {} } catch { return {} }
}
function itemsArr(it: unknown): Record<string, unknown>[] {
  if (Array.isArray(it)) return it as Record<string, unknown>[]
  if (typeof it === 'string') { try { const p = JSON.parse(it); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0)

function fmtMoney(n: number) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' млн ₽'
  if (Math.abs(n) >= 10_000)    return Math.round(n / 1_000) + ' тыс ₽'
  return Math.round(n).toLocaleString('ru-RU') + ' ₽'
}
const fmtFull = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

function orderCost(row: OrderRow) {
  let mat = 0, temp = 0, all = 0
  for (const x of itemsArr(row.items)) {
    mat += num(x.costMaterial); temp += num(x.costTempering); all += num(x.costWithVat)
  }
  return { mat, temp, other: Math.max(0, all - mat - temp), all }
}
const revenue = (r: OrderRow) => num(r.total_after_discount) || num(r.total_sale_inc_vat)

async function fetchAll(): Promise<OrderRow[]> {
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const cols = 'id, created_at, client_name, total_after_discount, total_sale_inc_vat, notes, items'
  const rows: OrderRow[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await svc.from('b2b_orders').select(cols).is('archived_at', null).order('created_at', { ascending: false }).range(from, from + page - 1)
    if (error || !data?.length) break
    rows.push(...(data as OrderRow[]))
    if (data.length < page) break
  }
  return rows
}

export default async function CfoB2BPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams
  const yearParam = sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : null

  const all = await fetchAll()
  const real = all.filter(r => !DRAFT.has(parseNotes(r.notes).status ?? ''))
  const drafts = all.length - real.length

  // Разрез по годам (year-over-year)
  const byYear = new Map<number, { rev: number; n: number; paidN: number; mat: number; temp: number; revItems: number; nItems: number }>()
  for (const r of real) {
    const y = new Date(r.created_at).getFullYear()
    const e = byYear.get(y) ?? { rev: 0, n: 0, paidN: 0, mat: 0, temp: 0, revItems: 0, nItems: 0 }
    e.rev += revenue(r); e.n++; if (revenue(r) > 0) e.paidN++
    if (itemsArr(r.items).length > 0) { const c = orderCost(r); e.mat += c.mat; e.temp += c.temp; e.revItems += revenue(r); e.nItems++ }
    byYear.set(y, e)
  }
  const yearRows = [...byYear.entries()].sort((a, b) => b[0] - a[0])
  const years = yearRows.map(([y]) => y)

  // Область: выбранный год или все годы
  const scope = yearParam ? real.filter(r => new Date(r.created_at).getFullYear() === yearParam) : real
  const scopeLabel = yearParam ? String(yearParam) : 'все годы'

  const totalRevenue = scope.reduce((s, r) => s + revenue(r), 0)
  const paidCount = scope.filter(r => revenue(r) > 0).length   // заказы с суммой (нулевые не занижают средний чек)
  const avgCheck = paidCount ? totalRevenue / paidCount : 0

  // Разбивка себестоимости — только заказы с items
  const withItems = scope.filter(r => itemsArr(r.items).length > 0)
  let mat = 0, temp = 0, other = 0, costAll = 0, revItems = 0
  for (const r of withItems) { const c = orderCost(r); mat += c.mat; temp += c.temp; other += c.other; costAll += c.all; revItems += revenue(r) }
  const profit = revItems - costAll
  const coverPct = totalRevenue > 0 ? Math.round((revItems / totalRevenue) * 100) : 0
  const gm = revItems > 0 ? (profit / revItems) * 100 : 0

  // Помесячно в области
  const byMonth = new Map<string, { rev: number; n: number; mat: number; temp: number; nItems: number }>()
  for (const r of scope) {
    const d = new Date(r.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const m = byMonth.get(key) ?? { rev: 0, n: 0, mat: 0, temp: 0, nItems: 0 }
    m.rev += revenue(r); m.n++
    if (itemsArr(r.items).length > 0) { const c = orderCost(r); m.mat += c.mat; m.temp += c.temp; m.nItems++ }
    byMonth.set(key, m)
  }
  const months = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))

  // Топ клиентов в области
  const byClient = new Map<string, { rev: number; n: number }>()
  for (const r of scope) {
    const key = (r.client_name || '').trim() || 'Без клиента'
    const c = byClient.get(key) ?? { rev: 0, n: 0 }
    c.rev += revenue(r); c.n++
    byClient.set(key, c)
  }
  const topClients = [...byClient.entries()].sort((a, b) => b[1].rev - a[1].rev).slice(0, 12)

  const shares = [
    { label: 'Материал', value: mat, cls: 'bg-sky-400', text: 'text-sky-700' },
    { label: 'Закалка', value: temp, cls: 'bg-orange-400', text: 'text-orange-700' },
    { label: 'Прочее', value: other, cls: 'bg-violet-400', text: 'text-violet-700' },
    { label: 'Валовая прибыль', value: Math.max(0, profit), cls: 'bg-emerald-400', text: 'text-emerald-700' },
  ]
  const shareTotal = shares.reduce((s, x) => s + x.value, 0) || 1

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1100px] mx-auto px-4 py-4 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">CFO Center — B2B аналитика</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">Оборотка, материал, закалка и прибыль по B2B · {scopeLabel} · {scope.length} заказов</p>
          </div>
          <Link href="/cfo" className="text-[10px] text-[#9a9a95] hover:text-[#111110]">← Дашборд</Link>
        </div>

        {/* Оборот по годам — YoY обзор */}
        <div>
          <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Оборот по годам</p>
          <div className="flex flex-wrap gap-3">
            {yearRows.map(([y, d]) => (
              <Link key={y} href={yearParam === y ? '/cfo/b2b' : `/cfo/b2b?year=${y}`}
                className={`flex-1 min-w-[150px] rounded-lg border px-3 py-3 transition-colors ${yearParam === y ? 'border-[#111110] bg-white ring-1 ring-[#111110]' : 'border-[#e4e4e0] bg-white hover:border-[#c4c4be]'}`}>
                <p className="text-[11px] font-semibold text-[#6b6b66]">{y} год</p>
                <p className="text-lg font-bold font-mono mt-0.5 text-[#111110] leading-tight">{fmtMoney(d.rev)}</p>
                <p className="text-[10px] text-[#9a9a95] mt-0.5">{d.n} заказов · чек {fmtMoney(d.paidN ? d.rev / d.paidN : 0)}</p>
              </Link>
            ))}
            {yearRows.length === 0 && <div className="text-xs text-[#9a9a95] px-1 py-3">Нет данных</div>}
          </div>
        </div>

        {/* Селектор года */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-white border border-[#e4e4e0] rounded-lg p-0.5 gap-0.5">
            <Link href="/cfo/b2b" className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${!yearParam ? 'bg-[#111110] text-white' : 'text-[#6b6b66] hover:bg-[#f5f5f3]'}`}>Все годы</Link>
            {years.map(y => (
              <Link key={y} href={`/cfo/b2b?year=${y}`} className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${yearParam === y ? 'bg-[#111110] text-white' : 'text-[#6b6b66] hover:bg-[#f5f5f3]'}`}>{y}</Link>
            ))}
          </div>
          {drafts > 0 && <span className="text-[10px] text-[#9a9a95]">черновики исключены: {drafts}</span>}
        </div>

        {/* KPI области */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Оборотка', value: fmtMoney(totalRevenue), hint: `за ${scopeLabel}` },
            { label: 'Заказов', value: String(scope.length), hint: 'без черновиков' },
            { label: 'Средний чек', value: fmtMoney(avgCheck), hint: 'оборотка / заказы' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-3">
              <p className="text-[10px] text-[#9a9a95] font-medium">{c.label}</p>
              <p className="text-lg font-bold font-mono mt-0.5 text-[#111110] leading-tight">{c.value}</p>
              <p className="text-[10px] text-[#c4c4be] mt-0.5">{c.hint}</p>
            </div>
          ))}
        </div>

        {/* Разбивка себестоимости */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Разбивка себестоимости</p>
            {withItems.length > 0 && <span className="text-[10px] text-[#9a9a95]">{withItems.length} из {scope.length} заказов · {coverPct}% оборота</span>}
          </div>

          {withItems.length === 0 ? (
            <div className="bg-white rounded-lg border border-[#e4e4e0] px-4 py-6 text-center">
              <p className="text-[13px] text-[#111110] font-medium">Пока нет заказов с детализацией себестоимости</p>
              <p className="text-[12px] text-[#9a9a95] mt-1 max-w-md mx-auto">
                Заказы 2026, импортированные из таблицы, не содержат позиций. Разбивка «материал / закалка / прочее»
                начнёт наполняться автоматически с заказов, оформленных через калькулятор B2B (с июля 2026).
              </p>
            </div>
          ) : (
            <>
              {coverPct < 90 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 mb-3 flex items-start gap-2">
                  <span className="text-amber-500 text-sm leading-none mt-0.5">ⓘ</span>
                  <p className="text-[10px] text-amber-700 leading-relaxed">
                    Материал и закалка посчитаны по {withItems.length} заказам с детальным расчётом ({coverPct}% оборота за {scopeLabel}).
                    Остальные заказы импортированы без разбивки — по ним видна только оборотка. Проценты и прибыль ниже относятся к обороту {fmtMoney(revItems)}.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-5 gap-3 mb-3">
                {[
                  { label: 'Оборотка (с расчётом)', value: fmtMoney(revItems), sub: `${withItems.length} заказов`, color: 'text-[#111110]' },
                  { label: 'Материал', value: fmtMoney(mat), sub: `${revItems ? Math.round(mat / revItems * 100) : 0}% оборота`, color: 'text-sky-700' },
                  { label: 'Закалка', value: fmtMoney(temp), sub: `${revItems ? Math.round(temp / revItems * 100) : 0}% оборота`, color: 'text-orange-700' },
                  { label: 'Прочее', value: fmtMoney(other), sub: 'фацет/кромка/дост.', color: 'text-violet-700' },
                  { label: 'Валовая прибыль', value: fmtMoney(profit), sub: `маржа ${gm.toFixed(0)}%`, color: profit > 0 ? 'text-emerald-700' : 'text-red-600' },
                ].map(c => (
                  <div key={c.label} className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-3">
                    <p className="text-[10px] text-[#9a9a95] font-medium">{c.label}</p>
                    <p className={`text-base font-bold font-mono mt-0.5 leading-tight ${c.color}`}>{c.value}</p>
                    <p className="text-[10px] text-[#c4c4be] mt-0.5">{c.sub}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
                <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Структура оборотки (заказы с расчётом)</p>
                <div className="flex h-3 rounded-full overflow-hidden mb-3">
                  {shares.map(s => <div key={s.label} className={s.cls} style={{ width: `${(s.value / shareTotal) * 100}%` }} title={`${s.label}: ${fmtFull(s.value)}`} />)}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  {shares.map(s => (
                    <div key={s.label} className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5"><span className={`inline-block w-2 h-2 rounded-sm ${s.cls}`} /><span className={s.text}>{s.label}</span></span>
                      <span className="font-mono text-[#6b6b66]">{fmtFull(s.value)} · {Math.round(s.value / shareTotal * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Помесячно */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e4e0]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Помесячно · {scopeLabel}</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#f5f5f3]">
                {['Месяц', 'Заказов', 'Оборотка', 'Материал*', 'Закалка*', 'С расчётом'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] text-[#9a9a95] font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map(([key, m]) => {
                const [y, mo] = key.split('-')
                return (
                  <tr key={key} className="border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9]">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{MONTHS[Number(mo) - 1]} {y}</td>
                    <td className="px-3 py-2 text-[#6b6b66]">{m.n}</td>
                    <td className="px-3 py-2 font-mono font-medium whitespace-nowrap">{fmtFull(m.rev)}</td>
                    <td className="px-3 py-2 font-mono text-sky-700 whitespace-nowrap">{m.mat ? fmtFull(m.mat) : '—'}</td>
                    <td className="px-3 py-2 font-mono text-orange-700 whitespace-nowrap">{m.temp ? fmtFull(m.temp) : '—'}</td>
                    <td className="px-3 py-2 text-[#9a9a95]">{m.nItems}/{m.n}</td>
                  </tr>
                )
              })}
              {months.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-[#9a9a95]">Нет данных</td></tr>}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[10px] text-[#c4c4be] border-t border-[#f5f5f3]">* материал и закалка — только по заказам с детальным расчётом (колонка «с расчётом»)</p>
        </div>

        {/* Топ клиентов */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e4e0]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Топ клиентов · {scopeLabel}</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#f5f5f3]">
                {['Клиент', 'Заказов', 'Оборотка'].map(h => <th key={h} className="px-3 py-2 text-left text-[10px] text-[#9a9a95] font-medium whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {topClients.map(([name, c]) => (
                <tr key={name} className="border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9]">
                  <td className="px-3 py-2 font-medium max-w-[260px] truncate">{name}</td>
                  <td className="px-3 py-2 text-[#6b6b66]">{c.n}</td>
                  <td className="px-3 py-2 font-mono font-medium whitespace-nowrap">{fmtFull(c.rev)}</td>
                </tr>
              ))}
              {topClients.length === 0 && <tr><td colSpan={3} className="px-3 py-8 text-center text-[#9a9a95]">Нет данных</td></tr>}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}
