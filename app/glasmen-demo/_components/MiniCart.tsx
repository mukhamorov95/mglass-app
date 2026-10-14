'use client'

import { useMemo, useState } from 'react'
import { applyOrderMinimum } from '@/lib/glasmen/priceParams'
import { confirmDialog } from '@/lib/dialog'
import { toast } from '@/lib/toast'
import type { ModelId, ParamsOverride, QuoteBody } from './api'
import { MODEL_LABEL, num, rub, VAT_LABEL } from './api'
import { useQuotes } from './useQuote'
import { Breakdown, Warnings } from './PricePanel'
import NumField from './NumField'

export type CartItem = {
  id: string
  name: string
  materialId: number
  materialLabel: string
  width: number
  height: number
  shape: 'rect' | 'curved'
  holes: { d: number; n: number }[]
  cutouts: number
  hasTempering: boolean
  hasFacet: boolean
  facetTypeMm?: number
  qty: number
}

const DISABLED_HINT = 'в демо не работает'

export default function MiniCart({
  items, onItems, model, discount, override,
}: {
  items: CartItem[]
  onItems: (next: CartItem[]) => void
  model: ModelId
  discount: number
  override: ParamsOverride | undefined
}) {
  const [open, setOpen] = useState<string | null>(null)

  // Строки корзины считаются без минимума заказа; минимум — правило заказа, ниже, по сумме строк.
  const bodies = useMemo<QuoteBody[] | null>(() => {
    if (!items.length) return null
    // aGroup: строки одного материала делят наладку; номер строки в группе решает, кому рубль остатка
    // (сервер делит методом наибольшего остатка, сумма по группе — ровно наладка).
    const perMaterial = new Map<number, number>()
    for (const it of items) perMaterial.set(it.materialId, (perMaterial.get(it.materialId) ?? 0) + 1)
    const seen = new Map<number, number>()
    const indexInGroup = items.map(it => {
      const i = seen.get(it.materialId) ?? 0
      seen.set(it.materialId, i + 1)
      return i
    })
    return items.map((it, idx) => ({
      materialId: it.materialId,
      width: it.width, height: it.height, shape: it.shape,
      holes: it.holes, cutouts: it.cutouts,
      hasTempering: it.hasTempering, hasFacet: it.hasFacet,
      ...(it.hasFacet && it.facetTypeMm ? { facetTypeMm: it.facetTypeMm } : {}),
      quantities: [it.qty],
      discountPct: discount,
      models: [model],
      ...(override && Object.keys(override).length ? { params: { [model]: override } } : {}),
      groupLines: perMaterial.get(it.materialId) ?? 1,
      groupIndex: indexInGroup[idx],
      asWholeOrder: false,
    }))
  }, [items, model, discount, override])

  const q = useQuotes(bodies)
  // Только ответ на текущий состав: старый ответ при другом составе приписал бы суммы не тем строкам.
  const fresh = q.data && q.data.length === items.length ? q.data : null

  const lines = fresh?.map(r => r.models[model]?.rows[0] ?? null) ?? null
  const allPriced = !!lines && lines.every(Boolean)
  const linesTotal = allPriced ? lines!.reduce((s, r) => s + r!.lineTotal, 0) : 0
  const res0 = fresh?.[0]?.models[model]
  const M = res0 && res0.paramsUsed.includes('M') ? res0.params.M : 0
  const order = allPriced ? applyOrderMinimum(linesTotal, { M }) : null
  const warnings = fresh ? [...new Set(fresh.flatMap(r => r.warnings))] : []
  const groupNote = model === 'aGroup' && bodies?.some(b => (b.groupLines ?? 1) > 1)

  const setQty = (id: string, n: number) => {
    const qty = Math.min(10000, Math.max(1, Math.round(n)))
    onItems(items.map(it => (it.id === id ? { ...it, qty } : it)))
  }
  const remove = (id: string) => {
    const idx = items.findIndex(it => it.id === id)
    const removed = items[idx]
    const before = items
    onItems(items.filter(it => it.id !== id))
    toast.info(`Убрано: ${removed.name}`, { action: { label: 'Вернуть', onClick: () => onItems(before) } })
  }
  const clear = async () => {
    const ok = await confirmDialog({ title: 'Очистить расчёт?', text: `Уберу все детали (${items.length}). Вернуть будет нельзя.`, confirmLabel: 'Очистить', danger: true })
    if (ok) onItems([])
  }

  return (
    <section className="space-y-3 rounded-2xl border border-[#e4e4e0] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Расчёт <span className="font-normal text-[#9a9a95]">· {items.length} дет.</span></h2>
        <span className="text-[12px] text-[#9a9a95]">вариант: {res0?.title ?? MODEL_LABEL[model]}</span>
      </div>

      {!items.length ? (
        <p className="text-[13px] text-[#9a9a95]">Пока пусто. Настройте деталь и нажмите «Добавить в расчёт». Расчёт хранится в этом браузере.</p>
      ) : (
        <>
          <ul className="divide-y divide-[#f0f0ed]">
            {items.map((it, i) => {
              const row = lines?.[i] ?? null
              const isOpen = open === it.id
              return (
                <li key={it.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button type="button" onClick={() => setOpen(isOpen ? null : it.id)} className="min-w-0 flex-1 text-left" aria-expanded={isOpen}>
                      <div className="truncate text-[13px] font-medium">{it.name}</div>
                      <div className="truncate text-[11px] text-[#9a9a95]">
                        {it.materialLabel} · {num(it.width)}×{num(it.height)} мм{it.hasTempering ? ' · закалка' : ''}{it.hasFacet ? ` · фацет ${it.facetTypeMm} мм` : ''}
                      </div>
                    </button>
                    <NumField value={it.qty} onChange={n => setQty(it.id, n)} className="w-20" suffix="шт." ariaLabel={`Количество: ${it.name}`} />
                    <span className="w-24 text-right text-[13px] tabular-nums">{row ? rub(row.lineTotal) : q.loading ? 'считаю…' : '—'}</span>
                    <button type="button" onClick={() => remove(it.id)} className="rounded px-1.5 text-[#9a9a95] hover:bg-[#f5f5f3] hover:text-red-700" aria-label={`Убрать ${it.name}`}>×</button>
                  </div>
                  {isOpen && row && <div className="mt-2 rounded-lg bg-[#fafaf9] p-2"><Breakdown row={row} /></div>}
                </li>
              )
            })}
          </ul>

          {q.error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">Не удалось посчитать {q.error}. Итог не показан.</p>}

          {order && (
            <div className="space-y-1 border-t border-[#e4e4e0] pt-2 text-[13px]">
              <div className="flex justify-between gap-3"><span className="text-[#55554f]">Сумма строк</span><span className="tabular-nums">{rub(linesTotal)}</span></div>
              {M > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-[#55554f]">
                    {order.minOrderApplied ? `Доплата до минимальной суммы заказа (${rub(M)})` : `Минимальная сумма заказа ${rub(M)} — достигнута`}
                  </span>
                  <span className="tabular-nums">{order.minOrderApplied ? `+${rub(order.topUp)}` : rub(0)}</span>
                </div>
              )}
              <div className="flex justify-between gap-3 border-t border-[#e4e4e0] pt-1 text-[15px] font-semibold">
                <span>Итого заказа</span><span className="tabular-nums">{rub(order.total)}</span>
              </div>
              <div className="text-[11px] text-[#9a9a95]">
                {VAT_LABEL}{discount ? `, после скидки ${discount} %` : ''}.{groupNote ? ' Наладка варианта A делится между строками одного материала.' : ''}
              </div>
            </div>
          )}
          <Warnings list={warnings} />

          <div className="flex justify-end">
            <button type="button" onClick={clear} className="text-[12px] text-[#9a9a95] underline underline-offset-2 hover:text-red-700">Очистить расчёт</button>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button type="button" disabled title={DISABLED_HINT} className="cursor-not-allowed rounded-xl bg-[#111110] px-4 py-2.5 text-[13px] font-medium text-white opacity-40">
          Получить счёт на юрлицо
        </button>
        <button type="button" disabled title={DISABLED_HINT} className="cursor-not-allowed rounded-xl border border-[#e4e4e0] px-4 py-2.5 text-[13px] opacity-50">
          Сохранить расчёт
        </button>
      </div>
      <p className="text-center text-[11px] text-[#9a9a95]">Счёт и сохранение — {DISABLED_HINT}.</p>
    </section>
  )
}
