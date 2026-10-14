'use client'

import { Fragment, useState } from 'react'
import type { ModelId, ParamsOverride, QuoteResponse, QuoteRow } from './api'
import { MODEL_IDS, MODEL_LABEL, num, rub, VAT_LABEL } from './api'
import type { QuoteState } from './useQuote'
import ParamsDrawer from './ParamsDrawer'

export function Warnings({ list }: { list: string[] | undefined }) {
  if (!list?.length) return null
  return (
    <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
      {list.map((w, i) => <li key={i}>⚠ {w}</li>)}
    </ul>
  )
}

export function Breakdown({ row }: { row: QuoteRow }) {
  const sum = row.breakdown.reduce((s, l) => s + l.amount, 0)
  const diff = Math.round((row.lineTotal - sum) * 100) / 100
  return (
    <div className="space-y-0.5 text-[12px]">
      {row.breakdown.map((l, i) => (
        <div key={i} className="flex justify-between gap-3">
          <span className="text-[#55554f]">{l.label}</span>
          <span className="shrink-0 tabular-nums">{l.amount > 0 && i > 0 ? '+' : ''}{rub(l.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t border-[#e4e4e0] pt-0.5 font-medium">
        <span>Итого строки, {VAT_LABEL}</span>
        <span className="shrink-0 tabular-nums">{rub(row.lineTotal)}</span>
      </div>
      {diff !== 0 && (
        <div className="text-red-700">Строки разбивки дают {rub(sum)}, итог строки {rub(row.lineTotal)} — расхождение {rub(diff)}. Ошибка расчёта, сообщите разработчику.</div>
      )}
    </div>
  )
}

export default function PricePanel({
  q, qty, blocked, hardNote = null, model, onModel, discount, onDiscount, overrides, onOverride, wholeOrder, onWholeOrder,
}: {
  q: QuoteState<QuoteResponse>
  qty: number                         // количество из шага 5: его строка выделена, итог — сверху
  blocked: string | null
  hardNote?: string | null            // жёсткие замечания черновых правил: цена — только для справки
  model: ModelId
  onModel: (m: ModelId) => void
  discount: number
  onDiscount: (d: number) => void
  overrides: Partial<Record<ModelId, ParamsOverride>>
  onOverride: (m: ModelId, patch: ParamsOverride | null) => void
  wholeOrder: boolean
  onWholeOrder: (v: boolean) => void
}) {
  const [openQty, setOpenQty] = useState<number | null>(null)
  const [drawer, setDrawer] = useState(false)
  const shown = q.data ?? q.last
  const res = shown?.models[model]
  const rows = res?.rows ?? []
  const one = rows.find(r => r.qty === 1)
  const mine = rows.find(r => r.qty === qty)
  const M = res && res.paramsUsed.includes('M') ? res.params.M : 0

  return (
    <section className="space-y-3 rounded-2xl border border-[#e4e4e0] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Цена</h2>
        <label className="flex items-center gap-2 text-[12px] text-[#55554f]">
          Скидка партнёра
          <select value={discount} onChange={e => onDiscount(Number(e.target.value))} className="rounded-lg border border-[#e4e4e0] bg-white px-2 py-1 text-[12px]">
            <option value={0}>0 %</option>
            <option value={10}>10 %</option>
          </select>
        </label>
      </div>

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Вариант цены">
        {MODEL_IDS.map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={model === id}
            onClick={() => { onModel(id); setOpenQty(null) }}
            className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[12px] ${model === id ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white text-[#55554f] hover:border-[#9a9a95]'}`}
          >
            {shown?.models[id]?.title ?? MODEL_LABEL[id]}
            {overrides[id] && Object.keys(overrides[id]!).length ? ' *' : ''}
          </button>
        ))}
      </div>

      {blocked ? (
        <p className="rounded-xl bg-[#f5f5f3] px-3 py-3 text-[13px] text-[#55554f]">{blocked}</p>
      ) : (
        <>
          {hardNote && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{hardNote}</p>}
          {q.error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">Не удалось посчитать: {q.error}.</p>}
          {!shown && !q.error && <div className="h-40 animate-pulse rounded-xl bg-[#f5f5f3]" aria-label="Считаю" />}
          {shown && res && (
            <div className={`space-y-3 transition-opacity ${q.loading || hardNote ? 'opacity-50' : ''} ${hardNote ? 'grayscale' : ''}`} aria-busy={q.loading}>
              {hardNote && <p className="text-[11px] font-medium uppercase tracking-wide text-[#55554f]">Для справки — деталь в таком виде не принимаем</p>}
              {mine && (
                <div className="rounded-xl bg-[#f5f5f3] px-3 py-2.5">
                  <div className="text-[12px] text-[#55554f]">{mine.qty} шт. × {rub(mine.perPiece)}</div>
                  <div className="text-[24px] font-semibold tabular-nums tracking-tight">{rub(mine.lineTotal)}</div>
                  <div className="text-[11px] text-[#9a9a95]">{VAT_LABEL}{discount ? `, после скидки ${discount} %` : ''}</div>
                </div>
              )}
              <p className="text-[12px] leading-snug text-[#55554f]">{res.description}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] text-[13px]">
                  <thead>
                    <tr className="border-b border-[#e4e4e0] text-left text-[11px] text-[#9a9a95]">
                      <th className="py-1.5 pr-2 font-normal">Шт.</th>
                      <th className="py-1.5 pr-2 text-right font-normal">За шт.</th>
                      <th className="py-1.5 pr-2 text-right font-normal">Итого строки</th>
                      <th className="py-1.5 text-right font-normal">к 1 шт.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const ch = one && one.perPiece > 0 && r.qty !== 1 ? Math.round((r.perPiece / one.perPiece - 1) * 100) : null
                      const open = openQty === r.qty
                      return (
                        <Fragment key={r.qty}>
                          <tr
                            className={`cursor-pointer border-b border-[#f0f0ed] hover:bg-[#fafaf9] ${open ? 'bg-[#fafaf9]' : ''} ${r.qty === qty ? 'font-semibold' : ''}`}
                            onClick={() => setOpenQty(open ? null : r.qty)}
                            aria-expanded={open}
                          >
                            <td className="py-2 pr-2">
                              <span className="mr-1 inline-block w-3 text-[#9a9a95]">{open ? '▾' : '▸'}</span>{r.qty}
                              {r.qty === qty && <span className="ml-1.5 rounded bg-[#111110] px-1 py-0.5 text-[10px] font-normal text-white">ваше</span>}
                              {r.floorApplied && <span className="ml-1.5 rounded bg-[#f5f5f3] px-1 py-0.5 text-[10px] text-[#55554f]" title="Цена поднята до минимальной цены позиции">мин. позиции</span>}
                              {r.minOrderApplied && <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-900" title="Доплата до минимальной суммы заказа">мин. заказа</span>}
                            </td>
                            <td className="py-2 pr-2 text-right font-medium tabular-nums">{rub(r.perPiece)}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{rub(r.lineTotal)}</td>
                            <td className={`py-2 text-right tabular-nums ${ch !== null && ch < 0 ? 'text-emerald-700' : 'text-[#9a9a95]'}`}>
                              {ch === null ? '—' : ch === 0 ? '0 %' : `${ch > 0 ? '+' : '−'}${Math.abs(ch)} %`}
                            </td>
                          </tr>
                          {open && (
                            <tr className="border-b border-[#f0f0ed] bg-[#fafaf9]">
                              <td colSpan={4} className="px-2 pb-3 pt-1"><Breakdown row={r} /></td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-[#9a9a95]">
                Все суммы {VAT_LABEL}{discount ? `, после скидки ${discount} %` : ''}. «За шт.» — итог строки ÷ шт., округлён до рубля. Нажмите строку — разбивка.
              </p>

              {M > 0 && (
                <label className="flex items-start gap-2 rounded-xl border border-[#e4e4e0] p-2.5 text-[12px] text-[#55554f]">
                  <input type="checkbox" className="mt-0.5 accent-[#111110]" checked={wholeOrder} onChange={e => onWholeOrder(e.target.checked)} />
                  <span>
                    Считать как весь заказ — применить минимум заказа {rub(M)} к этой строке.
                    <span className="block text-[#9a9a95]">Без галочки минимум считается в «Расчёте» ниже, по сумме всех деталей.</span>
                  </span>
                </label>
              )}

              <div className="rounded-xl border border-[#e4e4e0]">
                <button type="button" onClick={() => setDrawer(d => !d)} className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px]" aria-expanded={drawer}>
                  <span>Параметры варианта <span className="text-[11px] text-amber-700">черновик — подбор для решения 4</span></span>
                  <span className="text-[#9a9a95]">{drawer ? '▴' : '▾'}</span>
                </button>
                {drawer && (
                  <div className="border-t border-[#e4e4e0] p-3">
                    <ParamsDrawer
                      model={model}
                      result={res}
                      override={overrides[model]}
                      onChange={patch => onOverride(model, { ...(overrides[model] ?? {}), ...patch })}
                      onReset={() => onOverride(model, null)}
                    />
                  </div>
                )}
              </div>

              <PartFacts r={shown} />
              <Warnings list={shown.warnings} />
            </div>
          )}
        </>
      )}
    </section>
  )
}

function PartFacts({ r }: { r: QuoteResponse }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl bg-[#fafaf9] p-3 text-[12px]">
      <dt className="text-[#9a9a95]">Материал</dt>
      <dd className="text-right">{r.material.name}, {num(r.material.thickness)} мм</dd>
      <dt className="text-[#9a9a95]">Прайс</dt>
      <dd className="text-right tabular-nums">{rub(r.material.pricePerM2)}/м²</dd>
      <dt className="text-[#9a9a95]">Площадь в цене (по габариту)</dt>
      <dd className="text-right tabular-nums">{num(r.areaPieceM2, 4)} м²</dd>
      <dt className="text-[#9a9a95]">Вес детали (по габариту)</dt>
      <dd className="text-right tabular-nums">{num(r.weightPieceKg, 2)} кг</dd>
      <dt className="text-[#9a9a95]">Надбавки</dt>
      <dd className="text-right">
        {r.surcharges.length ? r.surcharges.map(s => `${s.name}: +${num(s.pct)} %`).join('; ') : 'нет'}
      </dd>
    </dl>
  )
}
