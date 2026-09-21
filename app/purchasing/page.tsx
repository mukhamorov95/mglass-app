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
  po: { id: number; supplier: string } | null
}
type SupplierOrder = {
  id: number; supplier: string; invoice: string | null; amount: number | null; status: string
  createdAt: string; expected: string | null; orders: string[]; sheets: number
}
type PoForm = { ids: number[]; supplierName: string; amount: string; invoice: string; expected: string; comment: string; estimate: number | null }
type Data = {
  queue: QueueOrder[]
  frontier: { lastId: number | null; gaps: number[]; after: number[] }
  counts: { active: number; cut: number; toOrder: number }
  needs: NeedRow[]
  unknown: UnknownMaterial[]
  resolved: { from: string; to: string; thickness: number; pieces: number; m2: number; orders: number[] }[]
  totals: { sheets: number; netM2: number; cost: number; unknownM2: number; itemsM2: number; triplexM2: number; totalM2: number }
  toOrderIds: number[]
  supplierOrders: SupplierOrder[]
  suppliers: { id: string; name: string }[]
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
  const [form, setForm] = useState<PoForm | null>(null)

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

  function openForm(ids: number[], estimate: number | null) {
    setMsg(null)
    setForm({ ids, supplierName: '', amount: estimate ? String(Math.round(estimate)) : '', invoice: '', expected: '', comment: '', estimate })
  }

  // «Заказал» → заказ поставщику + отметка «заказан» одним действием.
  async function submitSupplierOrder() {
    if (!form) return
    if (!form.supplierName.trim()) { setMsg('Укажите поставщика'); return }
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/purchasing/supplier-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderIds: form.ids, supplierName: form.supplierName.trim(), amount: form.amount,
          invoiceNumber: form.invoice, expectedDate: form.expected, comment: form.comment,
        }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j) { setMsg(j?.error ?? 'Не удалось завести заказ поставщику'); return }
      const parts = [`Заказ поставщику №${j.purchaseOrderId} заведён, отмечено «заказан»: ${j.marked.length}`]
      if (j.skipped?.length) parts.push(`пропущено ${j.skipped.length} (уже заказаны или нарезаны)`)
      if (j.failed?.length) parts.push(`не отметились: ${j.failed.map((f: { id: number }) => f.id).join(', ')}`)
      setMsg(parts.join(' · '))
      setForm(null); setPicked(new Set())
      await load(withCut)
    } finally { setBusy(false) }
  }

  async function arrived(poId: number) {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/purchasing/supplier-order/arrived', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseOrderId: poId }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j) { setMsg(j?.error ?? 'Не сохранилось'); return }
      const parts = [`Материал по заказу поставщику №${poId} пришёл, «есть»: ${j.marked.length}`]
      if (j.skipped?.length) parts.push(`не тронуты ${j.skipped.length} — у них уже стояла другая отметка`)
      setMsg(parts.join(' · '))
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
              <button onClick={() => openForm(d.toOrderIds, d.totals.cost)} disabled={busy}
                className="px-3 py-2 rounded-lg bg-[#111110] text-white text-[12.5px] font-semibold disabled:opacity-40">
                Заказал — завести заказ поставщику
              </button>
            )}
          </div>
          {form && (
            <div className="px-4 py-3 border-b border-[#e4e4e0] bg-[#fafaf9] space-y-2">
              <p className="text-[13px] font-semibold text-[#111110]">
                Заказ поставщику на {form.ids.length} {form.ids.length === 1 ? 'заказ' : 'заказов'}
              </p>
              <p className="text-[11.5px] text-[#9a9a95]">
                Позиции (материал, листы, формат, м²) система посчитает сама тем же раскроем и положит в канбан закупок.
                Заказам поставится «заказан». Поставщику ничего не отправляется.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <div>
                  <input list="purch-suppliers" value={form.supplierName} onChange={e => setForm({ ...form, supplierName: e.target.value })}
                    placeholder="Поставщик *" className="w-full px-3 py-2 border border-[#e4e4e0] rounded-lg text-[13px] bg-white outline-none focus:border-[#111110]" />
                  <datalist id="purch-suppliers">{d.suppliers.map(sp => <option key={sp.id} value={sp.name} />)}</datalist>
                </div>
                <input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value.replace(/[^\d.,]/g, '') })} inputMode="decimal"
                  placeholder={form.estimate ? 'Сумма' : 'Сумма (пусто — оценка по раскрою)'}
                  className="px-3 py-2 border border-[#e4e4e0] rounded-lg text-[13px] bg-white outline-none focus:border-[#111110]" />
                <input value={form.invoice} onChange={e => setForm({ ...form, invoice: e.target.value })} placeholder="№ счёта"
                  className="px-3 py-2 border border-[#e4e4e0] rounded-lg text-[13px] bg-white outline-none focus:border-[#111110]" />
                <input type="date" value={form.expected} onChange={e => setForm({ ...form, expected: e.target.value })} title="Когда ждём материал"
                  className="px-3 py-2 border border-[#e4e4e0] rounded-lg text-[13px] bg-white outline-none focus:border-[#111110]" />
              </div>
              <input value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} placeholder="Комментарий (необязательно)"
                className="w-full px-3 py-2 border border-[#e4e4e0] rounded-lg text-[13px] bg-white outline-none focus:border-[#111110]" />
              {form.estimate != null && <p className="text-[11px] text-[#9a9a95]">Оценка по раскрою и ценам справочника: {rub(form.estimate)}. Если сумма счёта другая — впишите её.</p>}
              <div className="flex flex-wrap gap-2">
                <button onClick={submitSupplierOrder} disabled={busy}
                  className="px-3 py-2 rounded-lg bg-[#111110] text-white text-[12.5px] font-semibold disabled:opacity-40">
                  {busy ? 'Завожу…' : 'Завести заказ поставщику и отметить'}
                </button>
                <button onClick={() => { const ids = form.ids; setForm(null); void mark(ids, 'ordered') }} disabled={busy}
                  className="px-3 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[12.5px] text-[#4b4b47] hover:border-[#111110] disabled:opacity-40">
                  Только отметить «заказан»
                </button>
                <button onClick={() => setForm(null)} className="px-3 py-2 text-[12.5px] text-[#9a9a95] hover:text-[#111110]">Отмена</button>
              </div>
            </div>
          )}
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
                  {/* Распознанное из названия изделия: видно, что во что превратилось. */}
                  {d.resolved.map(r => (
                    <tr key={`r-${r.from}-${r.to}`}>
                      <td colSpan={8} className="px-3 py-1.5 text-[11px] text-[#6b6b66] bg-[#fbfbfa]">
                        «{r.from}» — это изделие: стекло распознано как <b>{withThickness(r.to, r.thickness)}</b>
                        {' '}({r.pieces} дет., {m2(r.m2)}, заказы {r.orders.map(id => byId.get(id)?.number ?? id).join(', ')}).
                      </td>
                    </tr>
                  ))}
                  {/* Итог раскрывается: из чего сложилась площадь «нетто». */}
                  <tr>
                    <td colSpan={8} className="px-3 py-2 text-[11px] text-[#9a9a95]">
                      Площадь позиций заказов {m2(d.totals.itemsM2)}
                      {d.totals.triplexM2 > 0 && <> + вторые слои триплекса {m2(d.totals.triplexM2)}</>}
                      {' '}= {m2(d.totals.totalM2)}: {m2(d.totals.netM2)} в строках
                      {d.totals.unknownM2 > 0 && <> + {m2(d.totals.unknownM2)} не распознано</>}.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Заказы поставщикам, по которым ждём материал */}
        {d.supplierOrders.length > 0 && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#e4e4e0] flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[14px] font-semibold text-[#111110]">Ждём материал · {d.supplierOrders.length}</p>
                <p className="text-[12px] text-[#9a9a95] mt-0.5">Заказы поставщикам, по которым материал ещё не пришёл. «Пришёл» ставит их заказам «есть».</p>
              </div>
              <Link href="/admin/procurement" className="text-[12px] text-[#0071e3] hover:underline">→ Канбан закупок</Link>
            </div>
            <div className="divide-y divide-[#f0f0ec]">
              {d.supplierOrders.map(p => (
                <div key={p.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] text-[#111110]">
                      <b>№{p.id}</b> · {p.supplier}{p.invoice ? ` · счёт ${p.invoice}` : ''}
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{p.status}</span>
                    </p>
                    <p className="text-[11.5px] text-[#9a9a95]">
                      от {dm(p.createdAt)}{p.expected ? ` · ждём ${dm(p.expected)}` : ''}
                      {p.sheets > 0 && ` · ${p.sheets} лист.`}
                      {p.amount != null && ` · ${rub(p.amount)}`}
                      {p.orders.length > 0 && ` · заказы: ${p.orders.join(', ')}`}
                    </p>
                  </div>
                  <button onClick={() => arrived(p.id)} disabled={busy}
                    className="px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-[12px] font-semibold text-emerald-700 disabled:opacity-40">
                    Пришёл
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
                <button key={s} onClick={() => s === 'ordered' ? openForm([...picked], null) : mark([...picked], s)} disabled={busy}
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
                      {o.po && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">в заказе поставщику №{o.po.id} · {o.po.supplier}</span>}
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
          «Заказал» заводит заказ поставщику в канбан закупок и ставит заказам «заказан»; «Пришёл» ставит им «есть».
          Отметка пишется в статус материала заказа — её же видят менеджер в «Заказах B2B» и цех. «Заказан» и «есть»
          убирают заказ из расчёта закупки и из раскроя «на закупку», «не заказан» возвращает. Склад листов пока не ведётся,
          поэтому рекомендация его не вычитает.
        </p>
      </div>
    </div>
  )
}
