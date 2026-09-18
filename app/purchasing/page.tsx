'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { withThickness, type NeedRow, type UnknownMaterial, type SupplyState } from '@/lib/purchasing/supply'

// Материал под заказы (docs/PURCHASING_ROUTE.md). Одна страница отвечает на два
// вопроса закупщика: на какой заказ материал последний раз заказывали — и что
// заказать сейчас, в листах и рублях. Заявки поставщику система не отправляет.

type QueueOrder = {
  id: number; number: string; client: string; createdAt: string
  state: SupplyState; materialStatus: string | null
  updatedAt: string | null; updatedByName: string | null
  cut: boolean; pieces: number; netM2: number; materials: string[]
}
type Data = {
  queue: QueueOrder[]
  frontier: { lastId: number | null; gaps: number[]; after: number[] }
  counts: { active: number; cut: number; toOrder: number }
  needs: NeedRow[]
  unknown: UnknownMaterial[]
  totals: { sheets: number; netM2: number; cost: number; unknownM2: number; itemsM2: number; triplexM2: number }
  toOrderIds: number[]
  canOpenCard: boolean
}

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const m2 = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('ru-RU')} м²`
const dm = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' })

const STATE_UI: Record<SupplyState, { label: string; on: string; dot: string }> = {
  not_ordered: { label: 'Не заказан', on: 'bg-red-50 border-red-300 text-red-700', dot: 'bg-red-500' },
  ordered: { label: 'Заказан', on: 'bg-blue-50 border-blue-300 text-blue-700', dot: 'bg-blue-500' },
  in_stock: { label: 'Есть', on: 'bg-emerald-50 border-emerald-300 text-emerald-700', dot: 'bg-emerald-500' },
}
const ORDER: SupplyState[] = ['not_ordered', 'ordered', 'in_stock']

export default function PurchasingPage() {
  const [d, setD] = useState<Data | null>(null)
  const [withCut, setWithCut] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async (cut: boolean) => {
    const r = await fetch(`/api/purchasing${cut ? '?cut=1' : ''}`)
    const j = await r.json().catch(() => null)
    if (r.ok && j) setD(j)
    else setMsg(j?.error ?? 'Не удалось загрузить')
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(withCut) }, [load, withCut])

  async function mark(ids: number[], state: SupplyState) {
    if (!ids.length) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/purchasing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, state }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j) { setMsg(j?.error ?? 'Не сохранилось'); return }
      if (j.failed?.length) setMsg(`Не сохранились: ${j.failed.map((f: { id: number }) => f.id).join(', ')}`)
      setPicked(new Set())
      await load(withCut)
    } finally { setBusy(false) }
  }

  const byId = useMemo(() => new Map((d?.queue ?? []).map(o => [o.id, o])), [d])
  const last = d?.frontier.lastId != null ? byId.get(d.frontier.lastId) : null

  if (!d) {
    return <div className="min-h-screen bg-[#f8f8f7] p-6 text-[13px] text-[#9a9a95]">{msg ?? 'Загрузка…'}</div>
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7] pb-24">
      <div className="max-w-[1200px] mx-auto px-4 py-5 space-y-4">
        <div>
          <h1 className="text-[18px] font-semibold text-[#111110]">📦 Материал под заказы</h1>
          <p className="text-[12.5px] text-[#6b6b66] mt-0.5 max-w-3xl">
            Заказы B2B по порядку добавления. Отметьте, на какие материал заказан или уже есть, —
            всё остальное система разложит на листы и скажет, что и сколько заказать.
            Заявку поставщику система не отправляет.
          </p>
        </div>

        {msg && <p className="text-[12px] text-[#c2410c]">{msg}</p>}

        {/* Граница: ответ на «на какой заказ мы последний раз заказывали материал» */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
          {last ? (
            <p className="text-[13.5px] text-[#111110]">
              Материал заказан или есть — по заказ <b>{last.number}</b> ({last.client}, от {dm(last.createdAt)}).
              {' '}После него без отметки — <b>{d.frontier.after.length}</b>.
            </p>
          ) : (
            <p className="text-[13.5px] text-[#111110]">
              Ни на один заказ в очереди материал не отмечен. Без отметки — <b>{d.frontier.after.length}</b>.
            </p>
          )}
          {d.frontier.gaps.length > 0 && (
            <p className="text-[12px] text-amber-700 mt-1">
              ⚠ Выше границы остались без отметки: {d.frontier.gaps.map(id => byId.get(id)?.number ?? id).join(', ')} — проверьте, не пропущены ли.
            </p>
          )}
        </div>

        {/* Что заказать */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#e4e4e0] flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[14px] font-semibold text-[#111110]">Что заказать · {d.counts.toOrder} {d.counts.toOrder === 1 ? 'заказ' : 'заказов'} без отметки</p>
              <p className="text-[12px] text-[#9a9a95] mt-0.5">
                Детали всех не заказанных и ещё не нарезанных заказов, разложенные на листы. Цена — по справочнику за м², за целые листы.
              </p>
            </div>
            {d.toOrderIds.length > 0 && (
              <button onClick={() => mark(d.toOrderIds, 'ordered')} disabled={busy}
                className="px-3 py-2 rounded-lg bg-[#111110] text-white text-[12.5px] font-semibold disabled:opacity-40">
                Заказал — отметить эти {d.toOrderIds.length}
              </button>
            )}
          </div>
          {d.needs.length === 0 && d.unknown.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-[#9a9a95]">На всё в очереди материал заказан или есть.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[13px]">
                <thead>
                  <tr className="bg-[#f7f7f5] border-b border-[#e4e4e0] text-[#9a9a95] text-[11px] uppercase">
                    <th className="text-left font-medium px-3 py-2">Материал</th>
                    <th className="text-right font-medium px-3 py-2">Деталей</th>
                    <th className="text-right font-medium px-3 py-2">Нетто</th>
                    <th className="text-right font-medium px-3 py-2">Листов</th>
                    <th className="text-right font-medium px-3 py-2">Площадь листов</th>
                    <th className="text-right font-medium px-3 py-2">КПД</th>
                    <th className="text-right font-medium px-3 py-2">≈ Стоимость</th>
                    <th className="text-left font-medium px-3 py-2">Заказы</th>
                  </tr>
                </thead>
                <tbody>
                  {d.needs.map(r => (
                    <tr key={r.key} className="border-b border-[#f0f0ec] last:border-0">
                      <td className="px-3 py-2 font-medium text-[#111110]">{r.label}</td>
                      <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{r.pieces}</td>
                      <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{m2(r.netM2)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">
                        {r.sheets} <span className="text-[11px] font-normal text-[#9a9a95]">× {r.sheetWidth}×{r.sheetHeight}</span>
                        {r.unplaced > 0 && <span title="Деталь больше листа — раскрой её не разложил" className="ml-1 text-amber-600">⚠{r.unplaced}</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{m2(r.sheetsM2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{r.efficiency}%</td>
                      <td className="px-3 py-2 text-right font-mono text-[#111110]" title={`${r.sheets} × ${r.sheetWidth}×${r.sheetHeight} мм × ${rub(r.pricePerM2)}/м²`}>{rub(r.cost)}</td>
                      <td className="px-3 py-2 text-[12px] text-[#6b6b66]">{r.orders.map(id => byId.get(id)?.number ?? id).join(', ')}</td>
                    </tr>
                  ))}
                  {d.unknown.map(u => (
                    <tr key={`u-${u.material}-${u.thickness}`} className="border-b border-[#f0f0ec] last:border-0 bg-amber-50/40">
                      <td className="px-3 py-2 text-[#111110]">
                        {withThickness(u.material, u.thickness)}
                        <span className="block text-[11px] text-amber-700">нет в справочнике материалов — на листы не разложено</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{u.pieces}</td>
                      <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{m2(u.m2)}</td>
                      <td className="px-3 py-2 text-right text-[#c4c4be]">—</td>
                      <td className="px-3 py-2 text-right text-[#c4c4be]">—</td>
                      <td className="px-3 py-2 text-right text-[#c4c4be]">—</td>
                      <td className="px-3 py-2 text-right text-[#c4c4be]">—</td>
                      <td className="px-3 py-2 text-[12px] text-[#6b6b66]">{u.orders.map(id => byId.get(id)?.number ?? id).join(', ')}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#fafaf9] border-t border-[#e4e4e0] font-semibold">
                    <td className="px-3 py-2 text-[#111110]">Итого</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{d.needs.reduce((s, r) => s + r.pieces, 0)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{m2(d.totals.netM2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{d.totals.sheets}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{m2(d.needs.reduce((s, r) => s + r.sheetsM2, 0))}</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{rub(d.totals.cost)}</td>
                    <td className="px-3 py-2 text-[11px] font-normal text-[#9a9a95]">
                      {d.totals.unknownM2 > 0 && `+ ${m2(d.totals.unknownM2)} не распознано`}
                    </td>
                  </tr>
                  {/* Итог раскрывается: из чего сложилась площадь «нетто». */}
                  <tr>
                    <td colSpan={8} className="px-3 py-2 text-[11px] text-[#9a9a95]">
                      Площадь позиций заказов {m2(d.totals.itemsM2)}
                      {d.totals.triplexM2 > 0 && <> + вторые слои триплекса {m2(d.totals.triplexM2)}</>}
                      {' '}= {m2(d.totals.netM2 + d.totals.unknownM2)}: {m2(d.totals.netM2)} в строках
                      {d.totals.unknownM2 > 0 && <> + {m2(d.totals.unknownM2)} не распознано</>}.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Очередь заказов по порядку добавления */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#e4e4e0] flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[14px] font-semibold text-[#111110]">Заказы по порядку добавления · {d.queue.length}</p>
              <p className="text-[12px] text-[#9a9a95] mt-0.5">
                {withCut ? 'Все заказы с 07.07, включая нарезанные.' : `Ещё не нарезанные. Нарезанных — ${d.counts.cut}: материал на них уже был.`}
              </p>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-[#6b6b66] cursor-pointer">
              <input type="checkbox" checked={withCut} onChange={e => setWithCut(e.target.checked)} />
              показать нарезанные
            </label>
          </div>

          {picked.size > 0 && (
            <div className="px-4 py-2 border-b border-[#e4e4e0] bg-[#fafaf9] flex items-center gap-2 flex-wrap text-[12px]">
              <span className="text-[#6b6b66]">Выбрано {picked.size}:</span>
              {ORDER.map(s => (
                <button key={s} onClick={() => mark([...picked], s)} disabled={busy}
                  className={`px-2.5 py-1 rounded-lg border ${STATE_UI[s].on} disabled:opacity-40`}>
                  {STATE_UI[s].label}
                </button>
              ))}
              <button onClick={() => setPicked(new Set())} className="ml-auto text-[#9a9a95] hover:text-[#111110]">снять выбор</button>
            </div>
          )}

          <div className="divide-y divide-[#f0f0ec]">
            {d.queue.map(o => (
              <div key={o.id}>
                <div className={`px-4 py-2.5 flex items-center gap-3 flex-wrap ${d.frontier.gaps.includes(o.id) ? 'bg-amber-50/50' : ''}`}>
                  <input type="checkbox" checked={picked.has(o.id)}
                    onChange={() => setPicked(prev => { const n = new Set(prev); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n })} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] text-[#111110]">
                      {d.canOpenCard
                        ? <Link href={`/b2b-deal/${o.id}`} className="font-semibold hover:underline">{o.number}</Link>
                        : <span className="font-semibold">{o.number}</span>}
                      <span className="text-[#9a9a95]"> · {dm(o.createdAt)} · </span>{o.client}
                      {o.cut && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[#f0f0ec] text-[#6b6b66]">нарезан</span>}
                    </p>
                    <p className="text-[11.5px] text-[#9a9a95] truncate">
                      {o.materials.join(' · ') || 'материал не указан'} · {o.pieces} дет. · {m2(o.netM2)}
                      {o.updatedAt && ` · отметил ${o.updatedByName ?? '—'} ${dm(o.updatedAt)}`}
                    </p>
                  </div>
                  {/* «Кнопочка горит»: выбранное состояние светится и сразу пишется в заказ */}
                  <div className="flex items-center gap-1 shrink-0">
                    {ORDER.map(s => {
                      const on = o.state === s
                      return (
                        <button key={s} onClick={() => !on && mark([o.id], s)} disabled={busy}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12px] ${on ? STATE_UI[s].on + ' font-semibold' : 'bg-white border-[#e4e4e0] text-[#9a9a95] hover:border-[#111110]'} disabled:opacity-60`}>
                          <span className={`w-2 h-2 rounded-full ${on ? STATE_UI[s].dot : 'bg-[#e4e4e0]'}`} />
                          {STATE_UI[s].label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {/* Черта под границей: всё ниже — без отметки, в расчёте «что заказать» */}
                {d.frontier.lastId === o.id && d.frontier.after.length > 0 && (
                  <div className="px-4 py-1 bg-[#111110] text-white text-[11px] tracking-wide">
                    ▲ материал заказан по этот заказ · ниже — {d.frontier.after.length} без отметки
                  </div>
                )}
              </div>
            ))}
            {d.queue.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-[#9a9a95]">Заказов в очереди нет.</p>}
          </div>
        </div>

        <p className="text-[11px] text-[#c4c4be]">
          Отметка пишется в статус материала заказа — её же видят менеджер в «Заказах B2B» и цех. «Заказан» и «есть»
          убирают заказ из расчёта закупки и из раскроя «на закупку», «не заказан» возвращает. Склад листов пока не ведётся,
          поэтому рекомендация его не вычитает.
        </p>
      </div>
    </div>
  )
}
