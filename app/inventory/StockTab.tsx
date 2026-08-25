'use client'

import { useMemo, useState } from 'react'
import type { InventoryItem } from '@/lib/inventory/types'
import {
  KIND_LABELS, CONTOUR_LABELS, UNIT_LABELS, describeQty, stockStatus, STATUS_META, toOrderQty,
} from '@/lib/inventory/units'
import { INPUT, money, patch, KIND_ORDER } from './shared'
import MoveDialog from './MoveDialog'
import ItemDialog from './ItemDialog'

type Props = {
  items: InventoryItem[]
  canWrite: boolean
  canSeeCost: boolean
  reload: () => void
}

type Edit = { min_qty?: number; target_qty?: number; location?: string }

const num = (s: string) => Number(String(s).replace(',', '.')) || 0

export default function StockTab({ items, canWrite, canSeeCost, reload }: Props) {
  const [edits, setEdits]   = useState<Record<number, Edit>>({})
  const [saving, setSaving] = useState(false)
  const [move, setMove]     = useState<{ item: InventoryItem; mode: 'in' | 'out' } | null>(null)
  const [card, setCard]     = useState<InventoryItem | null>(null)
  const [error, setError]   = useState<string | null>(null)

  const grouped = useMemo(() => {
    const map = new Map<string, InventoryItem[]>()
    for (const i of items) {
      const list = map.get(i.kind) ?? []
      list.push(i)
      map.set(i.kind, list)
    }
    return KIND_ORDER.filter(k => map.has(k)).map(k => [k, map.get(k)!] as const)
  }, [items])

  const dirty = Object.keys(edits).length

  function edit(id: number, patchEdit: Edit) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patchEdit } }))
  }

  async function saveSettings() {
    setSaving(true); setError(null)
    try {
      await patch('/api/inventory/items', {
        items: Object.entries(edits).map(([id, e]) => ({ id: Number(id), ...e })),
      })
      setEdits({})
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const val = (i: InventoryItem, k: keyof Edit) => edits[i.id]?.[k] ?? i[k]

  if (!items.length) return (
    <div className="text-[13px] text-[#9a9a95] py-10 text-center">
      Позиций нет. Заведите их из справочников — кнопка «Из справочников» сверху.
    </div>
  )

  return (
    <div>
      {dirty > 0 && (
        <div className="sticky top-0 z-10 mb-3 flex items-center justify-between bg-[#111110] text-white rounded px-3 py-2 text-[13px]">
          <span>Изменено настроек: {dirty}</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 rounded border border-white/30 hover:bg-white/10" onClick={() => setEdits({})}>Отменить</button>
            <button className="px-3 py-1 rounded bg-white text-[#111110]" onClick={saveSettings} disabled={saving}>
              {saving ? 'Сохраняю…' : 'Сохранить'}
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-[13px] text-red-600 mb-2">{error}</div>}

      {grouped.map(([kind, list]) => (
        <div key={kind} className="mb-6">
          <div className="text-[13px] font-medium text-[#111110] mb-2">
            {KIND_LABELS[kind as keyof typeof KIND_LABELS]}
            <span className="text-[#9a9a95] font-normal"> · {list.length}</span>
          </div>

          <div className="overflow-x-auto border border-[#e4e4e0] rounded-lg bg-white">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[#9a9a95] border-b border-[#e4e4e0]">
                  <th className="text-left  font-normal px-3 py-2">Позиция</th>
                  <th className="text-left  font-normal px-3 py-2 w-32">Место</th>
                  <th className="text-right font-normal px-3 py-2 w-44">Остаток</th>
                  <th className="text-right font-normal px-3 py-2 w-20">Мин</th>
                  <th className="text-right font-normal px-3 py-2 w-20">Норма</th>
                  <th className="text-right font-normal px-3 py-2 w-24">Дозакуп</th>
                  {canSeeCost && <th className="text-right font-normal px-3 py-2 w-28">Стоимость</th>}
                  <th className="text-right font-normal px-3 py-2 w-28">Статус</th>
                  {canWrite && <th className="text-right font-normal px-3 py-2 w-24"></th>}
                </tr>
              </thead>
              <tbody>
                {list.map(i => {
                  const st   = stockStatus({ qty: i.qty, min_qty: Number(val(i, 'min_qty')), target_qty: Number(val(i, 'target_qty')) })
                  const meta = STATUS_META[st]
                  const need = toOrderQty({ qty: i.qty, min_qty: Number(val(i, 'min_qty')), target_qty: Number(val(i, 'target_qty')) })
                  return (
                    <tr key={i.id} className="border-b border-[#e4e4e0] last:border-0 hover:bg-[#f5f5f3]">
                      <td className="px-3 py-2">
                        <button className="text-left text-[#111110] hover:underline" onClick={() => setCard(i)}>
                          {i.name}
                        </button>
                        <span className="ml-2 text-[11px] text-[#9a9a95]">{CONTOUR_LABELS[i.contour]}</span>
                        {i.article && <span className="ml-2 text-[11px] text-[#9a9a95]">{i.article}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <input className={`${INPUT} w-full`} disabled={!canWrite}
                          value={String(val(i, 'location') ?? '')}
                          onChange={e => edit(i.id, { location: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {describeQty(i.qty, i.unit, i.pack_label, i.pack_size)}
                      </td>
                      <td className="px-3 py-2">
                        <input className={`${INPUT} w-full text-right`} disabled={!canWrite} inputMode="decimal"
                          value={String(val(i, 'min_qty') ?? 0)}
                          onChange={e => edit(i.id, { min_qty: num(e.target.value) })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className={`${INPUT} w-full text-right`} disabled={!canWrite} inputMode="decimal"
                          value={String(val(i, 'target_qty') ?? 0)}
                          onChange={e => edit(i.id, { target_qty: num(e.target.value) })} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#9a9a95]">
                        {need > 0 ? `${need} ${UNIT_LABELS[i.unit]}` : '—'}
                      </td>
                      {canSeeCost && (
                        <td className="px-3 py-2 text-right tabular-nums text-[#9a9a95]">
                          {i.avg_cost > 0 ? money(Math.max(0, i.qty) * i.avg_cost) : '—'}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right">
                        <span className={`inline-block px-2 py-0.5 rounded border text-[11px] ${meta.cls}`}>{meta.label}</span>
                      </td>
                      {canWrite && (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button className="px-2 py-1 text-[13px] rounded border border-[#e4e4e0] hover:bg-white"
                            title="Приход" onClick={() => setMove({ item: i, mode: 'in' })}>+</button>
                          <button className="ml-1 px-2 py-1 text-[13px] rounded border border-[#e4e4e0] hover:bg-white"
                            title="Расход" onClick={() => setMove({ item: i, mode: 'out' })}>−</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {move && (
        <MoveDialog item={move.item} mode={move.mode} canSeeCost={canSeeCost}
          onClose={() => setMove(null)} onDone={() => { setMove(null); reload() }} />
      )}
      {card && (
        <ItemDialog item={card} onClose={() => setCard(null)} onDone={() => { setCard(null); reload() }} />
      )}
      {!canWrite && (
        <div className="text-[12px] text-[#9a9a95] mt-2">Только просмотр: движения ведут снабжение и производство.</div>
      )}
    </div>
  )
}
