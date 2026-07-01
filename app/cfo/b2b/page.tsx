import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

// B2B-аналитика: оборотка + разбивка себестоимости (материал / закалка / прочее) + прибыль.
// Оборотка считается по всем заказам; разбивка себестоимости — только по заказам, где
// сохранён items (сделаны через калькулятор). Импортированные из таблицы заказы items не
// имеют, поэтому доли себестоимости показываются отдельно с явным покрытием.

export const dynamic = 'force-dynamic'

type OrderRow = {
  id: number
  created_at: string
  client_name: string | null
  margin_percent: number | null
  total_after_discount: number | null
  total_sale_inc_vat: number | null
  notes: string | null
  items: unknown
}

const DRAFT = new Set(['quote', 'pending_approval', 'rejected'])

const PERIODS = [
  { key: 'month',   label: 'Месяц',   days: 30  },
  { key: 'quarter', label: 'Квартал', days: 90  },
  { key: 'half',    label: 'Полгода', days: 180 },
  { key: 'year',    label: 'Год',     days: 365 },
  { key: 'all',     label: 'Всё',     days: -1  },
] as const

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

// Себестоимость заказа по позициям (все с НДС, как считает калькулятор)
function orderCost(row: OrderRow) {
  let mat = 0, temp = 0, all = 0
  for (const x of itemsArr(row.items)) {
    mat += num(x.costMaterial)
    temp += num(x.costTempering)
    all += num(x.costWithVat)
  }
  return { mat, temp, other: Math.max(0, all - mat - temp), all }
}
const revenue = (r: OrderRow) => num(r.total_after_discount) || num(r.total_sale_inc_vat)

async function fetchAll(): Promise<OrderRow[]> {
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const cols = 'id, created_at, client_name, margin_percent, total_after_discount, total_sale_inc_vat, notes, items'
  const rows: OrderRow[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    // archived_at IS NULL — иначе в сумму попадают архивные прогоны импорта (v1/v2 + старые), и оборотка утраивается.
    const { data, error } = await svc.from('b2b_orders').select(cols).is('archived_at', null).order('created_at', { ascending: false }).range(from, from + page - 1)
    if (error || !data?.length) break
    rows.push(...(data as OrderRow[]))
    if (data.length < page) break
  }
  return rows
}

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

export default async function CfoB2BPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams
  const periodKey = (PERIODS.find(p => p.key === sp.period)?.key) ?? 'all'
  const periodDays = PERIODS.find(p => p.key === periodKey)!.days

  const all = await fetchAll()

  // фильтр периода
  const cutoff = periodDays >= 0 ? new Date().getTime() - periodDays * 86_400_000 : -Infinity
  const inPeriod = all.filter(r => new Date(r.created_at).getTime() >= cutoff)

  // реальные заказы (без черновиков) — это и есть оборотка
  const real = inPeriod.filter(r => !DRAFT.has(parseNotes(r.notes).status ?? ''))
  const drafts = inPeriod.length - real.length

  const totalRevenue = real.reduce((s, r) => s + revenue(r), 0)
  const avgCheck = real.length ? totalRevenue / real.length : 0

  // разбивка себестоимости — только по заказам с items
  const withItems = real.filter(r => itemsArr(r.items).length > 0)
  let mat = 0, temp = 0, other = 0, costAll = 0, revItems = 0
  for (const r of withItems) {
    const c = orderCost(r)
    mat += c.mat; temp += c.temp; other += c.other; costAll += c.all
    revItems += revenue(r)
  }
  const profit = revItems - costAll
  const coverPct = totalRevenue > 0 ? Math.round((revItems / totalRevenue) * 100) : 0
  const gm = revItems > 0 ? (profit / revItems) * 100 : 0

  // по месяцам (весь диапазон, независимо от периода) — оборотка по всем реальным заказам
  const realAll = all.filter(r => !DRAFT.has(parseNotes(r.notes).status ?? ''))
  const byMonth = new Map<string, { rev: number; n: number; mat: number; temp: number; nItems: number }>()
  for (const r of realAll) {
    const d = new Date(r.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const m = byMonth.get(key) ?? { rev: 0, n: 0, mat: 0, temp: 0, nItems: 0 }
    m.rev += revenue(r); m.n++
    if (itemsArr(r.items).length > 0) { const c = orderCost(r); m.mat += c.mat; m.temp += c.temp; m.nItems++ }
    byMonth.set(key, m)
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  // топ клиентов за период
  const byClient = new Map<string, { rev: number; n: number; mat: number; temp: number }>()
  for (const r of real) {
    const key = (r.client_name || '').trim() || 'Без клиента'
    const c = byClient.get(key) ?? { rev: 0, n: 0, mat: 0, temp: 0 }
    c.rev += revenue(r); c.n++
    const oc = orderCost(r); c.mat += oc.mat; c.temp += oc.temp
    byClient.set(key, c)
  }
  const topClients = [...byClient.entries()].sort((a, b) => b[1].rev - a[1].rev).slice(0, 12)

  const shares = [
    { label: 'Материал', value: mat, cls: 'bg-sky-400', text: 'text-sky-700' },
    { label: 'Закалка', value: temp, cls: 'bg-orange-400', text: 'text-orange-700' },
    { label: 'Прочее (фацет/кромка/доставка/упак.)', value: other, cls: 'bg-violet-400', text: 'text-violet-700' },
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
            <p className="text-[10px] text-[#9a9a95] mt-0.5">Оборотка, материал, закалка и прибыль по B2B · {real.length} заказов в периоде</p>
          </div>
          <Link href="/cfo" className="text-[10px] text-[#9a9a95] hover:text-[#111110]">← Дашборд</Link>
        </div>

        {/* Period */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-white border border-[#e4e4e0] rounded-lg p-0.5 gap-0.5">
            {PERIODS.map(p => (
              <Link key={p.key} href={`/cfo/b2b?period=${p.key}`}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${periodKey === p.key ? 'bg-[#111110] text-white' : 'text-[#6b6b66] hover:bg-[#f5f5f3]'}`}>
                {p.label}
              </Link>
            ))}
          </div>
          {drafts > 0 && <span className="text-[10px] text-[#9a9a95]">черновики исключены из оборота: {drafts}</span>}
        </div>

        {/* Оборот — все реальные заказы */}
        <div>
          <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Оборот (все заказы в работе)</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Оборотка', value: fmtMoney(totalRevenue), hint: 'цена клиенту, после скидки' },
              { label: 'Заказов', value: String(real.length), hint: 'без черновиков' },
              { label: 'Средний чек', value: fmtMoney(avgCheck), hint: 'оборотка / заказы' },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-3">
                <p className="text-[10px] text-[#9a9a95] font-medium">{c.label}</p>
                <p className="text-lg font-bold font-mono mt-0.5 text-[#111110] leading-tight">{c.value}</p>
                <p className="text-[10px] text-[#c4c4be] mt-0.5">{c.hint}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Разбивка себестоимости — только заказы с расчётом */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Разбивка себестоимости</p>
            <span className="text-[10px] text-[#9a9a95]">{withItems.length} из {real.length} заказов · {coverPct}% оборота</span>
          </div>

          {withItems.length === 0 ? (
            <div className="bg-white rounded-lg border border-[#e4e4e0] px-4 py-6 text-center">
              <p className="text-[13px] text-[#111110] font-medium">Пока нет заказов с детализацией себестоимости</p>
              <p className="text-[12px] text-[#9a9a95] mt-1 max-w-md mx-auto">
                Текущие заказы 2026 импортированы из таблицы без позиций. Разбивка «материал / закалка / прочее»
                начнёт наполняться автоматически с июльских заказов, оформленных через калькулятор B2B.
              </p>
            </div>
          ) : (
            <>
              {coverPct < 90 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 mb-3 flex items-start gap-2">
                  <span className="text-amber-500 text-sm leading-none mt-0.5">ⓘ</span>
                  <p className="text-[10px] text-amber-700 leading-relaxed">
                    Материал и закалка посчитаны по {withItems.length} заказам с детальным расчётом (это {coverPct}% оборота).
                    Остальные заказы импортированы из таблицы без разбивки — по ним видна только оборотка.
                    Проценты и прибыль ниже относятся к обороту {fmtMoney(revItems)}, а не к полному.
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

              {/* Стек-бар: из чего складывается оборотка заказов с расчётом */}
              <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
                <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Структура оборотки (заказы с расчётом)</p>
                <div className="flex h-3 rounded-full overflow-hidden mb-3">
                  {shares.map(s => (
                    <div key={s.label} className={s.cls} style={{ width: `${(s.value / shareTotal) * 100}%` }} title={`${s.label}: ${fmtFull(s.value)}`} />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  {shares.map(s => (
                    <div key={s.label} className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5">
                        <span className={`inline-block w-2 h-2 rounded-sm ${s.cls}`} />
                        <span className={s.text}>{s.label}</span>
                      </span>
                      <span className="font-mono text-[#6b6b66]">{fmtFull(s.value)} · {Math.round(s.value / shareTotal * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* По месяцам */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e4e0]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Оборотка по месяцам (весь 2026)</p>
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
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Топ клиентов по обороту (в периоде)</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#f5f5f3]">
                {['Клиент', 'Заказов', 'Оборотка', 'Материал*', 'Закалка*'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] text-[#9a9a95] font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topClients.map(([name, c]) => (
                <tr key={name} className="border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9]">
                  <td className="px-3 py-2 font-medium max-w-[220px] truncate">{name}</td>
                  <td className="px-3 py-2 text-[#6b6b66]">{c.n}</td>
                  <td className="px-3 py-2 font-mono font-medium whitespace-nowrap">{fmtFull(c.rev)}</td>
                  <td className="px-3 py-2 font-mono text-sky-700 whitespace-nowrap">{c.mat ? fmtFull(c.mat) : '—'}</td>
                  <td className="px-3 py-2 font-mono text-orange-700 whitespace-nowrap">{c.temp ? fmtFull(c.temp) : '—'}</td>
                </tr>
              ))}
              {topClients.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-[#9a9a95]">Нет данных за период</td></tr>}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}
