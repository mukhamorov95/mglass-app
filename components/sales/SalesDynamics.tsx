'use client'

// Динамика продаж по месяцам: выбранный год против прошлого (владелец 22.10.2026).
// Один экран на два контура — /sales/dynamics (M-Glass) и /b2b-crm/dynamics (B2B).
// Итоги года сравниваются за одинаковое окно «с 1 января по сегодняшнее число».

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { deltaPct, type Contour, type Totals, type YearSeries } from '@/lib/sales/dynamics'

type Data = {
  contour: Contour; year: number; prev: number; today: string; cutoff: string
  scope: 'all' | 'own'; canMoney: boolean
  series: Record<string, YearSeries>
  totals: { cur: Totals; prev: Totals }
  money: { unit: 'ip' | 'ooo'; coveredTo: string; cutoff: string; cur: number; prev: number } | null
}
type Metric = 'sales' | 'count' | 'money'

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const rub = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const ddmm = (mmdd: string) => `${mmdd.slice(3)}.${mmdd.slice(0, 2)}`

function Delta({ cur, prev, big }: { cur: number; prev: number; big?: boolean }) {
  const d = deltaPct(cur, prev)
  if (d == null) return <span className="text-[#9a9a95]">—</span>
  return (
    <span className={`font-semibold ${d > 0 ? 'text-emerald-700' : d < 0 ? 'text-red-600' : 'text-[#6b6b66]'} ${big ? 'text-[13px]' : ''}`}>
      {d > 0 ? '+' : ''}{d.toLocaleString('ru-RU')}%
    </span>
  )
}

export function SalesDynamics({ contour }: { contour: Contour }) {
  const [year, setYear] = useState<number | null>(null)
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [metric, setMetric] = useState<Metric>('sales')

  useEffect(() => {
    let alive = true
    fetch(`/api/sales/dynamics?contour=${contour}${year ? `&year=${year}` : ''}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `ошибка ${r.status}`); return j as Data })
      .then(j => { if (alive) { setData(j); setErr(null) } })
      .catch((e: Error) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [contour, year])

  const title = contour === 'b2b' ? 'B2B' : 'M-Glass'
  const countLabel = contour === 'b2b' ? 'Заказов' : 'Продаж (объектов)'
  const back = contour === 'b2b' ? { href: '/b2b-crm', label: '← CRM B2B' } : { href: '/sales', label: '← Продажи M-Glass' }

  if (err) return <div className="min-h-screen bg-[#f5f5f3] p-6 text-[13px] text-red-600">Не загрузилось: {err}</div>
  if (!data) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  const cur = data.series[data.year], prev = data.series[data.prev]
  const curYear = Number(data.today.slice(0, 4))
  const partial = data.year === curYear
  const nowMonth = Number(data.today.slice(5, 7)) - 1
  const future = (m: number) => partial && m > nowMonth
  // Месяц последней выписки известен не целиком (по 25.08 и т.п.) — сравнивать его с полным
  // месяцем прошлого года нельзя, как и идущий месяц.
  const cov = data.money?.coveredTo
  const covM = cov ? Number(cov.slice(5, 7)) - 1 : -1
  const covWhole = !!cov && new Date(Date.UTC(Number(cov.slice(0, 4)), covM + 1, 0)).getUTCDate() === Number(cov.slice(8))
  const moneyCut = metric === 'money' && cov && !covWhole && Number(cov.slice(0, 4)) === data.year
    && !(partial && covM === nowMonth) ? covM : -1
  const incomplete = (m: number) => (partial && m === nowMonth) || m === moneyCut
  const windowLabel = data.cutoff === '12-31' ? 'за год' : `с 1 января по ${ddmm(data.cutoff)}`
  const metricOf = (s: YearSeries, m: number): number | null =>
    metric === 'sales' ? s.sales[m] : metric === 'count' ? s.count[m] : s.money ? s.money[m] : null
  const isRub = metric !== 'count'
  const show = (v: number | null) => v == null ? null : isRub ? rub(v) : v.toLocaleString('ru-RU')
  const maxV = Math.max(1, ...Array.from({ length: 12 }, (_, m) => Math.max(metricOf(cur, m) ?? 0, metricOf(prev, m) ?? 0)))
  const colSum = (s: YearSeries) => Array.from({ length: 12 }, (_, m) => metricOf(s, m) ?? 0).reduce((a, b) => a + b, 0)
  const moneyUnit = data.money?.unit === 'ooo' ? 'ООО' : 'ИП'

  const cards: { label: string; cur: string; prev: string; c: number; p: number; hint: string }[] = [
    { label: `Продажи ${data.year}`, cur: rub(data.totals.cur.sales), prev: rub(data.totals.prev.sales), c: data.totals.cur.sales, p: data.totals.prev.sales, hint: windowLabel },
    { label: countLabel, cur: data.totals.cur.count.toLocaleString('ru-RU'), prev: data.totals.prev.count.toLocaleString('ru-RU'), c: data.totals.cur.count, p: data.totals.prev.count, hint: windowLabel },
    { label: 'Средний чек', cur: rub(data.totals.cur.avg), prev: rub(data.totals.prev.avg), c: data.totals.cur.avg, p: data.totals.prev.avg, hint: 'продажи ÷ количество' },
  ]
  if (data.money) cards.push({
    label: 'Поступило денег', cur: rub(data.money.cur), prev: rub(data.money.prev), c: data.money.cur, p: data.money.prev,
    hint: data.money.cutoff === '12-31' ? `ДДС ${moneyUnit}, за год` : `ДДС ${moneyUnit}, с 1 января по ${ddmm(data.money.cutoff)}`,
  })

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-16">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-5 pb-4">
        <div className="max-w-[1100px] mx-auto">
          <Link href={back.href} className="text-[12px] text-[#9a9a95] hover:text-[#111110]">{back.label}</Link>
          <div className="flex items-end justify-between gap-3 flex-wrap mt-1">
            <div>
              <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Динамика продаж · {title}</h1>
              <p className="text-[12px] text-[#9a9a95] mt-0.5">
                {contour === 'b2b'
                  ? 'Заказы B2B без просчётов, по дате заказа, суммы с НДС'
                  : 'Книга продаж M-Glass, по дате продажи'}
                {' · '}{data.year} против {data.prev}
              </p>
            </div>
            <div className="flex bg-[#f0f0ec] rounded-lg p-0.5">
              {[curYear, curYear - 1].map(y => (
                <button key={y} onClick={() => setYear(y)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium ${data.year === y ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66]'}`}>
                  {y} vs {y - 1}
                </button>
              ))}
            </div>
          </div>
          {data.scope === 'own' && (
            <p className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 inline-block">
              Только ваши продажи. Продажи всей компании видят владелец и коммерческий директор.
            </p>
          )}
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-4 pt-4 space-y-4">
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${cards.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3`}>
          {cards.map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95]">{c.label}</p>
              <p className="text-[22px] font-bold font-mono text-[#111110] mt-1 leading-tight">{c.cur}</p>
              <p className="text-[12px] text-[#6b6b66] mt-1">{data.prev}: <span className="font-mono">{c.prev}</span> · <Delta cur={c.c} prev={c.p} /></p>
              <p className="text-[11px] text-[#9a9a95] mt-0.5">{c.hint}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="flex bg-[#f0f0ec] rounded-lg p-0.5">
              {([['sales', 'Продажи, ₽'], ['count', countLabel], ...(data.money ? [['money', 'Поступило, ₽']] : [])] as [Metric, string][]).map(([k, l]) => (
                <button key={k} onClick={() => setMetric(k)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium ${metric === k ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66]'}`}>{l}</button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[#6b6b66]">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[#c9c9c3]" />{data.prev}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[#111110]" />{data.year}</span>
            </div>
          </div>

          <div className="flex items-end gap-1 sm:gap-2 h-[200px] border-b border-[#e4e4e0]">
            {SHORT.map((label, m) => {
              const p = metricOf(prev, m), c = future(m) ? null : metricOf(cur, m)
              const h = (v: number | null) => v == null ? 0 : Math.max(v > 0 ? 2 : 0, Math.round(v / maxV * 190))
              return (
                <div key={label} className="flex-1 min-w-0 flex items-end justify-center gap-[2px] h-full">
                  <div title={`${MONTHS[m]} ${data.prev}: ${show(p) ?? 'нет данных'}`}
                    className="w-1/2 max-w-[22px] bg-[#c9c9c3] rounded-t-sm" style={{ height: h(p) }} />
                  <div title={`${MONTHS[m]} ${data.year}: ${future(m) ? 'ещё не наступил' : show(c) ?? 'нет данных'}`}
                    className={`w-1/2 max-w-[22px] rounded-t-sm ${incomplete(m) ? 'bg-[#111110]/60' : 'bg-[#111110]'}`} style={{ height: h(c) }} />
                </div>
              )
            })}
          </div>
          <div className="flex gap-1 sm:gap-2 mt-1">
            {SHORT.map(l => <div key={l} className="flex-1 min-w-0 text-center text-[10px] text-[#9a9a95] truncate">{l}</div>)}
          </div>
          <p className="text-[11px] text-[#9a9a95] mt-2">
            Наведите на столбик — сумма за месяц.
            {partial && ` ${MONTHS[nowMonth]} ${data.year} ещё идёт (по ${ddmm(data.today.slice(5))}) — столбик светлее.`}
            {metric === 'money' && data.money && ` Деньги ${moneyUnit} известны по ${data.money.coveredTo.split('-').reverse().join('.')}: дальше выписка не загружена.`}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-x-auto">
          <table className="w-full text-[13px] whitespace-nowrap">
            <thead>
              <tr className="text-[11px] text-[#9a9a95] border-b border-[#f0f0ec]">
                <th className="text-left font-medium px-4 py-2">Месяц</th>
                <th className="text-right font-medium px-3 py-2">{data.prev}</th>
                <th className="text-right font-medium px-3 py-2">{data.year}</th>
                <th className="text-right font-medium px-4 py-2">Изменение</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((name, m) => {
                const p = metricOf(prev, m), c = metricOf(cur, m)
                return (
                  <tr key={name} className="border-b border-[#f5f5f3] last:border-0">
                    <td className="px-4 py-1.5 text-[#111110]">{name}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-[#6b6b66]">{show(p) ?? <span className="text-[#c4c4be] font-sans text-[12px]">нет выписки</span>}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-[#111110]">
                      {future(m) ? <span className="text-[#c4c4be]">—</span> : show(c) ?? <span className="text-[#c4c4be] font-sans text-[12px]">нет выписки</span>}
                    </td>
                    <td className="px-4 py-1.5 text-right text-[12px]">
                      {future(m) ? '' : partial && m === nowMonth ? <span className="text-[#9a9a95]">месяц идёт</span>
                        : m === moneyCut && cov ? <span className="text-[#9a9a95]">только по {cov.slice(8)}.{cov.slice(5, 7)}</span>
                        : c == null || p == null ? <span className="text-[#c4c4be]">—</span> : <Delta cur={c} prev={p} />}
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t border-[#e4e4e0] font-semibold">
                <td className="px-4 py-2 text-[#111110]">Сумма месяцев</td>
                <td className="px-3 py-2 text-right font-mono">{isRub ? rub(colSum(prev)) : colSum(prev).toLocaleString('ru-RU')}</td>
                <td className="px-3 py-2 text-right font-mono">{isRub ? rub(colSum(cur)) : colSum(cur).toLocaleString('ru-RU')}</td>
                <td className="px-4 py-2 text-right text-[11px] font-normal text-[#9a9a95]">{partial ? `${data.year} — по ${ddmm(data.today.slice(5))}; равное окно — в карточках сверху` : ''}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {contour === 'b2b' && data.series[data.prev] && (
          <p className="text-[11px] text-[#9a9a95] px-1">
            Заказы до 2026 года перенесены из таблицы помесячно — у них дата заказа 15-е число месяца. Сравнение по месяцам точное, по дням внутри месяца — нет.
          </p>
        )}
      </div>
    </div>
  )
}
