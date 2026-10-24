import Link from 'next/link'
import { redirect } from 'next/navigation'
import { canAccessRoute, getRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { launchedOrders, orderAmount, isOwnRetail } from '@/lib/liveOrders'
import { pageAll, type PageResult } from '@/lib/supabase/pageAll'
import { deltaPct } from '@/lib/sales/dynamics'
import { mskDayKey } from '@/lib/time'
import {
  PRESETS, B2B_DAILY_FROM, resolvePeriod, lastYear, b2bExact, bucketOf, byBucket, split, b2bAll, companySum, avg,
  periodLabel, ddmm, weekday, monthName, type B2BSale, type Period, type Sale, type Split,
} from '@/lib/sales/periodSales'

// Продажи M-Glass и B2B за любой период на одном экране (владелец 23.10.2026).
// Только выручка: маржа и себестоимость живут в /cfo.
// M-Glass — книга продаж, как «Продажи M-Glass»; B2B — запущенные в работу заказы по дате
// запуска, как «Отчёт по клиентам». Заказы цеха для своей розницы (клиент M GLASS) уже
// сидят в продаже M-Glass клиенту, поэтому в «Итого компании» не входят.

export const dynamic = 'force-dynamic'

const PATH = '/ceo/sales'
type Svc = ReturnType<typeof createServiceClient>
type B2BRow = { launched_at: string; client_name: string | null; total_after_discount: number | null; total_sale_inc_vat: number | null }

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v)) || 0
const rub = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const int = (n: number) => n.toLocaleString('ru-RU')
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
}

async function loadMglass(sb: Svc, p: Period): Promise<Sale[]> {
  const rows = await pageAll<{ sale_date: string; amount: unknown }>((a, b) =>
    sb.from('crm_sales').select('id,sale_date,amount')
      .eq('voided', false).neq('department', 'b2b')
      .gte('sale_date', p.from).lte('sale_date', p.to)
      .order('id').range(a, b))
  return rows.map(r => ({ date: r.sale_date, amount: num(r.amount) }))
}

async function loadB2B(sb: Svc, p: Period): Promise<B2BSale[]> {
  const rows = await pageAll<B2BRow>((a, b) =>
    launchedOrders(sb, 'id,launched_at,client_name,total_after_discount,total_sale_inc_vat')
      .gte('launched_at', p.from).lte('launched_at', p.to)
      .order('id').range(a, b) as unknown as PromiseLike<PageResult<B2BRow>>)
  return rows.map(r => ({ date: String(r.launched_at).slice(0, 10), amount: orderAmount(r), own: isOwnRetail(r.client_name) }))
}

async function lastBookDay(sb: Svc, today: string): Promise<string | null> {
  const { data } = await sb.from('crm_sales').select('sale_date')
    .eq('voided', false).neq('department', 'b2b').lte('sale_date', today)
    .order('sale_date', { ascending: false }).limit(1).maybeSingle()
  return (data as { sale_date: string } | null)?.sale_date ?? null
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const d = deltaPct(cur, prev)
  if (d == null) return <span className="text-[#9a9a95]">—</span>
  return (
    <span className={`font-semibold ${d > 0 ? 'text-emerald-700' : d < 0 ? 'text-red-600' : 'text-[#6b6b66]'}`}>
      {d > 0 ? '+' : ''}{d.toLocaleString('ru-RU')}%
    </span>
  )
}

function Compare({ label, cur, prev, ok, why }: { label: string; cur: number; prev: number; ok: boolean; why: string }) {
  if (!ok) return <p className="text-[12px] text-[#9a9a95] mt-1">{label}: сравнения нет — {why}</p>
  return (
    <p className="text-[12px] text-[#6b6b66] mt-1">
      {label}: <span className="font-mono">{rub(prev)}</span> · <Delta cur={cur} prev={prev} />
    </p>
  )
}

export default async function CeoSalesPage({ searchParams }: { searchParams: Promise<{ p?: string; from?: string; to?: string }> }) {
  // Ниже service-role читает обе книги в обход RLS — роль проверяем здесь же, не только в middleware.
  const role = await getRole()
  if (!canAccessRoute(role, PATH)) redirect('/access-denied')

  const today = mskDayKey()
  const { preset, period } = resolvePeriod(await searchParams, today)
  const prevPeriod = lastYear(period)
  const prevYear = Number(prevPeriod.from.slice(0, 4))
  const sb = createServiceClient()

  let cur: { m: Sale[]; b: B2BSale[] } = { m: [], b: [] }
  let prev: { m: Sale[]; b: B2BSale[] } = { m: [], b: [] }
  let bookDay: string | null = null
  let error: string | null = null
  try {
    const [m, b, pm, pb, d] = await Promise.all([
      loadMglass(sb, period), loadB2B(sb, period), loadMglass(sb, prevPeriod), loadB2B(sb, prevPeriod), lastBookDay(sb, today),
    ])
    cur = { m, b }; prev = { m: pm, b: pb }; bookDay = d
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  const s: Split = split(cur.m, cur.b)
  const ps: Split = split(prev.m, prev.b)
  const b2bNow = b2bAll(s), b2bPrev = b2bAll(ps)
  const curExact = b2bExact(period), prevExact = b2bExact(prevPeriod)
  const monthlyWhy = `B2B ${prevYear} перенесён помесячно, все заказы месяца стоят на 15-м`
  const shownTo = period.to < today ? period.to : today
  const bookBehind = bookDay != null && bookDay < shownTo
  const rows = byBucket(cur.m, cur.b, period)
  const bucket = bucketOf(period)
  const maxRow = Math.max(1, ...rows.map(r => companySum(r) + r.b2bOwn.sum))
  const sumRows = (f: (r: Split) => number) => rows.reduce((a, r) => a + f(r), 0)
  const canB2BReport = canAccessRoute(role, '/b2b-crm/report')
  const canSales = canAccessRoute(role, '/sales')

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-16">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-5 pb-4">
        <div className="max-w-[1100px] mx-auto">
          <Link href="/ceo" className="text-[12px] text-[#9a9a95] hover:text-[#111110]">← CEO</Link>
          <h1 className="text-[20px] font-bold text-[#111110] tracking-tight mt-1">Продажи по периодам · M-Glass + B2B</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">
            {periodLabel(period)} · сравнение с тем же периодом {prevYear} года · суммы с НДС
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div className="flex flex-wrap bg-[#f0f0ec] rounded-lg p-0.5">
              {PRESETS.map(x => (
                <Link key={x.id} href={`${PATH}?p=${x.id}`}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium ${preset === x.id ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66] hover:text-[#111110]'}`}>
                  {x.label}
                </Link>
              ))}
            </div>
            <form method="get" action={PATH} className={`flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 ${preset === 'range' ? 'bg-white border border-[#111110]' : 'bg-[#f0f0ec]'}`}>
              <span className="text-[12px] text-[#6b6b66]">Период: с</span>
              <input type="date" name="from" defaultValue={period.from} required
                className="text-[12px] bg-white border border-[#e4e4e0] rounded px-1.5 py-1" />
              <span className="text-[12px] text-[#6b6b66]">по</span>
              <input type="date" name="to" defaultValue={period.to} required
                className="text-[12px] bg-white border border-[#e4e4e0] rounded px-1.5 py-1" />
              <button type="submit" className="text-[12px] font-medium bg-[#111110] text-white rounded px-2.5 py-1">Показать</button>
            </form>
          </div>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-4 pt-4 space-y-3">
        {error && (
          <p className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Не загрузилось: {error}. Цифры ниже неполные — обновите страницу.
          </p>
        )}
        {bookBehind && bookDay && (
          <p className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Последняя продажа в книге M-Glass — {ddmm(bookDay)}. Книга подтягивается из таблицы продаж каждое утро:
            если после {ddmm(bookDay)} продажи были, их ещё не внесли в таблицу. Ноль M-Glass за эти дни — не «продаж не было».
          </p>
        )}
        {!curExact && (
          <p className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            B2B до 2026 года известен только по месяцам: все заказы месяца стоят на 15-м числе. За неполный месяц до 2026 года сумма B2B неточна — выберите целые месяцы.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95]">M-Glass · розница</p>
            <p className="text-[24px] font-bold font-mono text-[#111110] mt-1 leading-tight">{rub(s.mglass.sum)}</p>
            <p className="text-[12px] text-[#6b6b66] mt-1">
              {int(s.mglass.count)} {plural(s.mglass.count, 'продажа', 'продажи', 'продаж')}
              {s.mglass.count > 0 && <> · средний чек <span className="font-mono">{rub(avg(s.mglass))}</span></>}
            </p>
            <Compare label={String(prevYear)} cur={s.mglass.sum} prev={ps.mglass.sum} ok why="" />
            <p className="text-[11px] text-[#9a9a95] mt-1">Книга продаж, по дате продажи</p>
            {canSales && <Link href="/sales" className="text-[11px] text-[#6b6b66] underline underline-offset-2 hover:text-[#111110] mt-1 inline-block">Продажи M-Glass →</Link>}
          </div>

          <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95]">B2B · производство</p>
            <p className="text-[24px] font-bold font-mono text-[#111110] mt-1 leading-tight">{rub(b2bNow.sum)}</p>
            <p className="text-[12px] text-[#6b6b66] mt-1">
              {int(b2bNow.count)} {plural(b2bNow.count, 'заказ', 'заказа', 'заказов')}
              {b2bNow.count > 0 && <> · средний чек <span className="font-mono">{rub(avg(b2bNow))}</span></>}
            </p>
            <p className="text-[12px] text-[#6b6b66] mt-1">
              из них для M-Glass: <span className="font-mono">{rub(s.b2bOwn.sum)}</span> · {int(s.b2bOwn.count)} {plural(s.b2bOwn.count, 'заказ', 'заказа', 'заказов')}
            </p>
            <Compare label={String(prevYear)} cur={b2bNow.sum} prev={b2bPrev.sum} ok={prevExact} why={monthlyWhy} />
            <p className="text-[11px] text-[#9a9a95] mt-1">Запущенные в работу заказы, по дате запуска</p>
            {canB2BReport && (
              <Link href={`/b2b-crm/report?from=${period.from}&to=${period.to}`}
                className="text-[11px] text-[#6b6b66] underline underline-offset-2 hover:text-[#111110] mt-1 inline-block">Отчёт по клиентам B2B →</Link>
            )}
          </div>

          <div className="bg-[#111110] rounded-xl px-4 py-3 text-white">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/60">Итого компании</p>
            <p className="text-[24px] font-bold font-mono mt-1 leading-tight">{rub(companySum(s))}</p>
            <p className="text-[12px] text-white/70 mt-1">
              M-Glass <span className="font-mono">{rub(s.mglass.sum)}</span> + B2B внешним клиентам <span className="font-mono">{rub(s.b2bExternal.sum)}</span>
            </p>
            {prevExact ? (
              <p className="text-[12px] text-white/70 mt-1">
                {prevYear}: <span className="font-mono">{rub(companySum(ps))}</span> · <DeltaDark cur={companySum(s)} prev={companySum(ps)} />
              </p>
            ) : (
              <p className="text-[12px] text-white/50 mt-1">{prevYear}: сравнения нет — {monthlyWhy}</p>
            )}
            <p className="text-[11px] text-white/50 mt-1">
              Заказы цеха для M-Glass ({rub(s.b2bOwn.sum)}) не прибавляются: они уже в продаже M-Glass клиенту
            </p>
          </div>
        </div>

        {rows.length > 1 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-x-auto">
            <table className="w-full text-[13px] whitespace-nowrap">
              <thead>
                <tr className="text-[11px] text-[#9a9a95] border-b border-[#f0f0ec]">
                  <th className="text-left font-medium px-4 py-2">{bucket === 'day' ? 'День' : 'Месяц'}</th>
                  <th className="text-right font-medium px-3 py-2">M-Glass</th>
                  <th className="text-right font-medium px-3 py-2">B2B внешним</th>
                  <th className="text-right font-medium px-3 py-2">B2B для M-Glass</th>
                  <th className="text-right font-medium px-3 py-2">Итого компании</th>
                  <th className="px-4 py-2 w-[30%] min-w-[120px]" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const total = companySum(r)
                  const empty = total === 0 && r.b2bOwn.sum === 0
                  const future = bucket === 'day' && r.key > today
                  const notInBook = bucket === 'day' && !future && bookDay != null && r.key > bookDay
                  const w = (v: number) => `${(v / maxRow) * 100}%`
                  return (
                    <tr key={r.key} className="border-b border-[#f5f5f3] last:border-0">
                      <td className="px-4 py-1.5 text-[#111110]">
                        {bucket === 'day'
                          ? <>{ddmm(r.key)} <span className={`text-[11px] ${['сб', 'вс'].includes(weekday(r.key)) ? 'text-[#c4c4be]' : 'text-[#9a9a95]'}`}>{weekday(r.key)}</span></>
                          : monthName(r.key)}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono ${r.mglass.sum ? 'text-[#111110]' : 'text-[#c4c4be]'}`}>
                        {r.mglass.sum ? rub(r.mglass.sum) : future ? '—' : notInBook ? <span className="font-sans text-[12px]">нет в книге</span> : '0'}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono ${r.b2bExternal.sum ? 'text-[#111110]' : 'text-[#c4c4be]'}`}>{r.b2bExternal.sum ? rub(r.b2bExternal.sum) : '0'}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${r.b2bOwn.sum ? 'text-[#6b6b66]' : 'text-[#c4c4be]'}`}>{r.b2bOwn.sum ? rub(r.b2bOwn.sum) : '0'}</td>
                      <td className={`px-3 py-1.5 text-right font-mono font-semibold ${total ? 'text-[#111110]' : 'text-[#c4c4be]'}`}>{total ? rub(total) : '0'}</td>
                      <td className="px-4 py-1.5">
                        {!empty && (
                          <div className="flex h-2.5 rounded-sm overflow-hidden bg-[#f5f5f3]" title={`M-Glass ${rub(r.mglass.sum)} · B2B внешним ${rub(r.b2bExternal.sum)} · B2B для M-Glass ${rub(r.b2bOwn.sum)}`}>
                            <div className="bg-[#111110]" style={{ width: w(r.mglass.sum) }} />
                            <div className="bg-[#8a8a84]" style={{ width: w(r.b2bExternal.sum) }} />
                            <div className="bg-[#d6d6d0]" style={{ width: w(r.b2bOwn.sum) }} />
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-t border-[#e4e4e0] font-semibold">
                  <td className="px-4 py-2 text-[#111110]">Итого</td>
                  <td className="px-3 py-2 text-right font-mono">{rub(sumRows(r => r.mglass.sum))}</td>
                  <td className="px-3 py-2 text-right font-mono">{rub(sumRows(r => r.b2bExternal.sum))}</td>
                  <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{rub(sumRows(r => r.b2bOwn.sum))}</td>
                  <td className="px-3 py-2 text-right font-mono">{rub(sumRows(companySum))}</td>
                  <td className="px-4 py-2" />
                </tr>
              </tbody>
            </table>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-t border-[#f0f0ec] text-[11px] text-[#6b6b66]">
              <span className="flex items-center gap-1"><span className="w-3 h-2.5 rounded-sm bg-[#111110]" />M-Glass</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2.5 rounded-sm bg-[#8a8a84]" />B2B внешним</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2.5 rounded-sm bg-[#d6d6d0]" />B2B для M-Glass (в итог не входит)</span>
              {bucket === 'day' && period.from < B2B_DAILY_FROM && <span className="text-[#9a9a95]">B2B до 2026 года — весь месяц на 15-м числе</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DeltaDark({ cur, prev }: { cur: number; prev: number }) {
  const d = deltaPct(cur, prev)
  if (d == null) return <span className="text-white/50">—</span>
  return <span className={`font-semibold ${d > 0 ? 'text-emerald-300' : d < 0 ? 'text-red-300' : 'text-white/70'}`}>{d > 0 ? '+' : ''}{d.toLocaleString('ru-RU')}%</span>
}
