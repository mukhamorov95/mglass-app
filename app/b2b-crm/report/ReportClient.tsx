'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { presetPeriod, NO_SOURCE, NO_CARD, type PresetId, type Summary, type MonthRow, type RankRow, type SourceRow } from '@/lib/b2b/clientReport'
import { sourceLabel } from '@/lib/types'
import { mskDayKey } from '@/lib/time'
import { searchByName } from '@/lib/search/translitMatch'

type GroupOpt = { key: string; label: string; ownRetail: boolean; merged: number }
type OrderRow = {
  id: number; number: string; launchedAt: string; amount: number
  byName: boolean; shipped: boolean; packaged: boolean; historical: boolean; clientName: string | null
}
type ClientInfo = { key: string; label: string; hasCard: boolean; ownRetail: boolean; cards: { id: number; name: string }[] }
type Report = {
  period: { from: string; to: string }
  seeAll: boolean
  groups: GroupOpt[]
  summary?: Summary
  byNameCount?: number
  ranking?: RankRow[]
  bySource?: SourceRow[]
  client?: ClientInfo | null
  notice?: string
  months?: MonthRow[]
  orders?: OrderRow[]
}

const srcLabel = (s: string) =>
  s === NO_CARD ? 'Без карточки клиента' : s === NO_SOURCE ? 'Не указан' : sourceLabel(s)

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'month', label: 'Этот месяц' },
  { id: 'prev_month', label: 'Прошлый месяц' },
  { id: 'quarter', label: 'Квартал' },
  { id: 'year', label: 'Этот год' },
  { id: 'prev_year', label: 'Прошлый год' },
  { id: 'all', label: 'Всё время' },
]
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const pct = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
const day = (k: string) => `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}`
const monthLabel = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`
// «из N заказа/заказов» — родительный падеж: из 1, 21, 121 заказа; из 2, 5, 11 заказов.
const ordersGen = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'заказа' : 'заказов')
const ordersWord = (n: number) => {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'заказ'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'заказа'
  return 'заказов'
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">{label}</p>
      <p className="text-[22px] font-bold font-mono leading-tight text-[#111110] truncate">{value}</p>
      {sub && <p className="text-[11px] text-[#9a9a95] mt-0.5">{sub}</p>}
    </div>
  )
}

function Badge({ children, tone = 'grey' }: { children: ReactNode; tone?: 'grey' | 'amber' }) {
  const cls = tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-[#f0f0ec] text-[#6b6b66]'
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{children}</span>
}

export default function ReportClient({ initial }: {
  initial: { client: string | null; g: string | null; from: string | null; to: string | null }
}) {
  const today = mskDayKey()
  const yearStart = presetPeriod('year', today)
  const [from, setFrom] = useState(initial.from ?? yearStart.from)
  const [to, setTo] = useState(initial.to ?? yearStart.to)
  const [g, setG] = useState<string | null>(initial.g)
  const [cardId, setCardId] = useState<string | null>(initial.client)

  const [data, setData] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paid, setPaid] = useState<Record<number, number> | null>(null)
  const [paidError, setPaidError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null); setPaid(null); setPaidError(null)
    const p = new URLSearchParams({ from, to })
    if (cardId) p.set('client', cardId)
    else if (g) p.set('g', g)
    // Адрес повторяет выбор: отчёт можно переслать ссылкой и открыть заново.
    try { window.history.replaceState(null, '', `/b2b-crm/report?${p}`) } catch { /* ignore */ }
    try {
      const r = await fetch(`/api/b2b/client-report?${p}`)
      const j = await r.json().catch(() => null) as (Report & { error?: string }) | null
      if (!r.ok || !j || j.error) { setError(j?.error ?? `Сервер ответил ${r.status}`); setData(null); return }
      setData(j)
      // Карточка из ссылки превратилась в группу — дальше ходим по группе.
      if (cardId && j.client?.key) { setCardId(null); setG(j.client.key) }
    } catch {
      setError('Сервер не ответил — проверьте связь'); setData(null)
    } finally { setLoading(false) }
  }, [from, to, g, cardId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка отчёта по выбору; состояние ставит сам запрос
  useEffect(() => { load() }, [load])

  // Оплаты — из payments, тем же запросом, что «B2B Заказы». Ведутся с 2026: историю не спрашиваем.
  const liveIds = useMemo(() => (data?.orders ?? []).filter(o => !o.historical).map(o => o.id), [data])
  useEffect(() => {
    if (!liveIds.length) return
    let cancelled = false
    fetch(`/api/b2b-orders/payments?ids=${liveIds.slice(0, 2000).join(',')}`)
      .then(async r => {
        const j = await r.json().catch(() => null) as { paid?: Record<number, number>; error?: string } | null
        if (cancelled) return
        if (!r.ok || !j?.paid) setPaidError(j?.error ?? `оплаты не загрузились (${r.status})`)
        else setPaid(j.paid)
      })
      .catch(() => { if (!cancelled) setPaidError('оплаты не загрузились — нет связи') })
    return () => { cancelled = true }
  }, [liveIds])

  useEffect(() => {
    const close = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // В обоих алфавитах (О8): «шо» → Shower Glass, «гласс» → M GLASS; лучшее совпадение выше.
  const matches = useMemo(() => searchByName(data?.groups ?? [], query, x => [x.label], 40), [query, data])

  const pick = (key: string | null) => { setCardId(null); setG(key); setQuery(''); setOpen(false) }
  const applyPreset = (id: PresetId) => { const p = presetPeriod(id, today); setFrom(p.from); setTo(p.to) }
  const activePreset = PRESETS.find(p => { const x = presetPeriod(p.id, today); return x.from === from && x.to === to })?.id

  const client = data?.client
  const orders = data?.orders ?? []
  const liveSum = orders.filter(o => !o.historical).reduce((s, o) => s + o.amount, 0)
  const paidSum = paid ? orders.reduce((s, o) => s + (paid[o.id] ?? 0), 0) : null
  const paidCount = paid ? orders.filter(o => (paid[o.id] ?? 0) > 0).length : 0
  const monthMax = Math.max(1, ...(data?.months ?? []).map(m => m.sum))
  const total = data?.summary?.sum ?? 0

  return (
    <div className="min-h-screen bg-[#f5f5f3]">
      <div className="max-w-[1100px] mx-auto px-4 py-5">
        <div className="mb-4">
          <h1 className="text-[16px] font-semibold text-[#111110]">Отчёт по клиентам</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">
            Заказы в работе по дате запуска, как в «B2B Заказах». Сумма — после скидки.
            {data && !data.seeAll && ' Только ваши заказы.'}
          </p>
        </div>

        {/* Выбор: клиент и период */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 mb-4 space-y-3">
          <div ref={boxRef} className="relative">
            <div className="flex gap-2 items-center">
              {g ? (
                <div className="flex-1 min-w-0 flex items-center gap-2 border border-[#111110] rounded-lg px-3 py-2">
                  <span className="text-[13px] font-medium text-[#111110] truncate">{client?.label ?? data?.groups.find(x => x.key === g)?.label ?? 'Клиент'}</span>
                  <button onClick={() => pick(null)} className="ml-auto text-[12px] text-[#6b6b66] hover:text-[#111110] shrink-0">✕ Все клиенты</button>
                </div>
              ) : (
                <input value={query} onChange={e => { setQuery(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
                  placeholder="Все клиенты — начните вводить название, чтобы выбрать одного"
                  className="flex-1 min-w-0 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
              )}
            </div>
            {open && !g && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-[#e4e4e0] rounded-lg shadow-lg max-h-72 overflow-y-auto">
                {matches.length === 0 && <p className="px-3 py-2 text-[12px] text-[#9a9a95]">Ничего не нашлось</p>}
                {matches.map(x => (
                  <button key={x.key} onClick={() => pick(x.key)}
                    className="w-full text-left px-3 py-2 text-[13px] text-[#111110] hover:bg-[#f8f8f7] flex items-center gap-2">
                    <span className="truncate">{x.label}</span>
                    {x.merged > 1 && <Badge>{x.merged} карточки</Badge>}
                    {x.ownRetail && <Badge tone="amber">своя розница</Badge>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => applyPreset(p.id)}
                className={`px-2.5 py-1.5 rounded-lg text-[12px] border transition-colors ${activePreset === p.id ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#111110] hover:bg-[#f8f8f7]'}`}>
                {p.label}
              </button>
            ))}
            <span className="flex items-center gap-1.5 ml-auto text-[12px] text-[#6b6b66]">
              с <input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)}
                className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px]" />
              по <input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)}
                className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px]" />
            </span>
          </div>
        </div>

        {loading && <div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-4 text-[13px] text-[#8a8a85]">Считаю заказы…</div>}
        {!loading && error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-[13px] text-red-700">
            Отчёт не посчитан: {error}
            <button onClick={load} className="ml-3 underline">Повторить</button>
          </div>
        )}
        {!loading && data?.notice && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-4 text-[13px] text-[#6b6b66]">{data.notice}</div>
        )}

        {/* Все клиенты: рейтинг */}
        {!loading && data && !g && data.summary && data.ranking && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Tile label="Заказов" value={String(data.summary.orders)} />
              <Tile label="Сумма" value={rub(data.summary.sum)} />
              <Tile label="Средний чек" value={rub(data.summary.avg)} sub="без нулевых заказов" />
              <Tile label="Клиентов" value={String(data.ranking.length)} sub={`с заказами за ${day(data.period.from)} — ${day(data.period.to)}`} />
            </div>
            {(data.bySource?.length ?? 0) > 0 && (
              <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] px-4 pt-3">Откуда пришли клиенты</p>
                <table className="w-full text-[13px] min-w-[480px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-widest text-[#9a9a95] border-b border-[#f0f0ec]">
                      <th className="text-left font-semibold px-4 py-2.5">Источник</th>
                      <th className="text-right font-semibold px-3 py-2.5">Клиентов</th>
                      <th className="text-right font-semibold px-3 py-2.5">Заказов</th>
                      <th className="text-right font-semibold px-3 py-2.5">Сумма</th>
                      <th className="text-right font-semibold px-4 py-2.5">Доля суммы</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f4f4f1]">
                    {data.bySource!.map(r => (
                      <tr key={r.source}>
                        <td className={`px-4 py-2.5 ${r.source === NO_SOURCE || r.source === NO_CARD ? 'text-[#9a9a95]' : 'text-[#111110] font-medium'}`}>{srcLabel(r.source)}</td>
                        <td className="text-right px-3 py-2.5 font-mono">{r.clients}</td>
                        <td className="text-right px-3 py-2.5 font-mono">{r.orders}</td>
                        <td className="text-right px-3 py-2.5 font-mono whitespace-nowrap">{rub(r.sum)}</td>
                        <td className="text-right px-4 py-2.5 font-mono text-[#6b6b66]">{total > 0 ? pct(r.sum / total * 100) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-[#9a9a95] px-4 pb-3 pt-1">Источник ставится в карточке клиента: «Изменить» → «Откуда пришёл».</p>
              </div>
            )}
            {data.ranking.length === 0 ? (
              <div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-4 text-[13px] text-[#9a9a95]">За этот период заказов нет.</div>
            ) : (
              <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto">
                <table className="w-full text-[13px] min-w-[560px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-widest text-[#9a9a95] border-b border-[#f0f0ec]">
                      <th className="text-left font-semibold px-4 py-2.5">Клиент</th>
                      <th className="text-right font-semibold px-3 py-2.5">Заказов</th>
                      <th className="text-right font-semibold px-3 py-2.5">Сумма</th>
                      <th className="text-right font-semibold px-3 py-2.5">Доля суммы</th>
                      <th className="text-right font-semibold px-4 py-2.5">Средний чек</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f4f4f1]">
                    {data.ranking.map(r => (
                      <tr key={r.key} onClick={() => pick(r.key)} className="cursor-pointer hover:bg-[#fafaf9]">
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5 flex-wrap">
                            <span className={`font-medium ${r.hasCard ? 'text-[#111110]' : 'text-[#6b6b66] italic'}`}>{r.label}</span>
                            {r.merged > 1 && <Badge>{r.merged} карточки</Badge>}
                            {r.ownRetail && <Badge tone="amber">своя розница</Badge>}
                            {!r.hasCard && r.key !== 'unknown' && <Badge>нет карточки</Badge>}
                          </span>
                        </td>
                        <td className="text-right px-3 py-2.5 font-mono">{r.orders}</td>
                        <td className="text-right px-3 py-2.5 font-mono whitespace-nowrap">{rub(r.sum)}</td>
                        <td className="text-right px-3 py-2.5 font-mono text-[#6b6b66]">{total > 0 ? pct(r.sum / total * 100) : '—'}</td>
                        <td className="text-right px-4 py-2.5 font-mono whitespace-nowrap text-[#6b6b66]">{rub(r.avg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(data.byNameCount ?? 0) > 0 && (
              <p className="text-[11px] text-[#9a9a95] mt-2">
                {data.byNameCount} {ordersWord(data.byNameCount!)} без ссылки на карточку привязаны по названию клиента или его юрлица — в основном история 2024–2025.
              </p>
            )}
          </>
        )}

        {/* Один клиент */}
        {!loading && data && g && client && data.summary && (
          <>
            <div className="mb-3 flex items-baseline gap-2 flex-wrap">
              <h2 className="text-[15px] font-semibold text-[#111110]">{client.label}</h2>
              {client.ownRetail && <Badge tone="amber">своя розница</Badge>}
              {client.cards.length > 1 && (
                <span className="text-[12px] text-[#9a9a95]">
                  объединены карточки:{' '}
                  {client.cards.map((c, i) => (
                    <span key={c.id}>{i > 0 && ', '}<Link href={`/b2b-crm/${c.id}`} className="underline hover:text-[#111110]">{c.name}</Link></span>
                  ))}
                </span>
              )}
              {client.cards.length === 1 && (
                <Link href={`/b2b-crm/${client.cards[0].id}`} className="text-[12px] text-[#6b6b66] underline hover:text-[#111110]">карточка клиента</Link>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Tile label="Заказов" value={String(data.summary.orders)} sub={`${day(data.period.from)} — ${day(data.period.to)}`} />
              <Tile label="Сумма" value={rub(data.summary.sum)} />
              <Tile label="Средний чек" value={rub(data.summary.avg)} sub="без нулевых заказов" />
              {/* Оплаты в приложении отмечены у малой части заказов (на 30.09 — у 74 из 1150
                  за 2026 г.): «0 ₽» читался бы как долг. Поэтому — «отмечено», со счётом заказов. */}
              <Tile label="Отмечено оплат"
                value={paidError ? '—' : paidSum == null ? (liveIds.length ? '…' : rub(0)) : rub(paidSum)}
                sub={paidError ? paidError : paid == null ? undefined
                  : `у ${paidCount} из ${liveIds.length} ${ordersGen(liveIds.length)} на ${rub(liveSum)}; без отметки — не значит «не оплачен»`} />
            </div>

            {orders.length === 0 ? (
              <div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-4 text-[13px] text-[#9a9a95]">За этот период заказов нет.</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">
                <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                  <p className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] border-b border-[#f0f0ec]">По месяцам</p>
                  <div className="divide-y divide-[#f4f4f1]">
                    {(data.months ?? []).map(m => (
                      <div key={m.month} className="px-4 py-2">
                        <div className="flex items-baseline justify-between text-[12px]">
                          <span className="text-[#111110]">{monthLabel(m.month)}</span>
                          <span className="font-mono text-[#111110]">{rub(m.sum)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="h-1.5 rounded-full bg-[#111110]" style={{ width: `${Math.max(2, m.sum / monthMax * 100)}%` }} />
                          <span className="text-[10px] text-[#9a9a95] whitespace-nowrap">{m.orders} {ordersWord(m.orders)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto">
                  <table className="w-full text-[13px] min-w-[520px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-widest text-[#9a9a95] border-b border-[#f0f0ec]">
                        <th className="text-left font-semibold px-4 py-2.5">Заказ</th>
                        <th className="text-left font-semibold px-3 py-2.5">Запуск</th>
                        <th className="text-right font-semibold px-3 py-2.5">Сумма</th>
                        <th className="text-right font-semibold px-3 py-2.5">Оплата</th>
                        <th className="text-left font-semibold px-4 py-2.5">Статус</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f4f4f1]">
                      {orders.map(o => {
                        const p = paid?.[o.id] ?? 0
                        return (
                          <tr key={o.id}>
                            <td className="px-4 py-2">
                              <Link href={`/b2b-deal/${o.id}`} className="font-mono font-semibold text-[#111110] hover:underline">{o.number}</Link>
                              {o.byName && <span title={`Привязан по названию «${o.clientName ?? ''}»: в заказе нет ссылки на карточку`} className="ml-1.5"><Badge>по названию</Badge></span>}
                            </td>
                            <td className="px-3 py-2 text-[#6b6b66] whitespace-nowrap">{day(o.launchedAt)}</td>
                            <td className="text-right px-3 py-2 font-mono whitespace-nowrap">{rub(o.amount)}</td>
                            <td className="text-right px-3 py-2 font-mono whitespace-nowrap text-[#6b6b66]">
                              {o.historical || paidError ? '—' : paid == null ? '…' : p > 0 ? rub(p) : <span title="Оплата в приложении не отмечена">—</span>}
                            </td>
                            <td className="px-4 py-2 text-[12px] whitespace-nowrap">
                              {o.historical ? <span className="text-[#9a9a95]">история</span>
                                : o.shipped ? <span className="text-green-700">отгружен</span>
                                : o.packaged ? <span className="text-emerald-700">готов / упакован</span>
                                : <span className="text-[#6b6b66]">в работе</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {(data.byNameCount ?? 0) > 0 && (
              <p className="text-[11px] text-[#9a9a95] mt-2">
                {data.byNameCount} {ordersWord(data.byNameCount!)} привязаны по названию клиента или юрлица — в заказе нет ссылки на карточку.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
