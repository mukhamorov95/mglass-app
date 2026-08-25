'use client'

import { useState } from 'react'
import type { InventoryItem } from '@/lib/inventory/types'
import { UNIT_LABELS, describeQty, packToBase } from '@/lib/inventory/units'
import { INPUT, BTN, BTN_P, post } from './shared'

type Props = { items: InventoryItem[]; canWrite: boolean; reload: () => void }

const num = (s: string) => Number(String(s).replace(',', '.'))

// Инвентаризация: вводим то, что реально лежит на полке. Разницу система
// оформит движением «count» — видно, кто и когда пересчитал.
export default function CountTab({ items, canWrite, reload }: Props) {
  const [facts, setFacts]   = useState<Record<number, string>>({})
  const [inPack, setInPack] = useState<Record<number, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError]   = useState<string | null>(null)

  function actualBase(i: InventoryItem): number | null {
    const raw = facts[i.id]
    if (raw === undefined || raw.trim() === '') return null
    const v = num(raw)
    if (Number.isNaN(v)) return null
    const usePack = inPack[i.id] ?? (!!i.pack_label && i.pack_size > 0)
    return usePack && i.pack_size > 0 ? packToBase(v, i.pack_size) : v
  }

  const filled = items.filter(i => actualBase(i) !== null)
  const changed = filled.filter(i => Math.abs((actualBase(i) as number) - i.qty) > 0.0001)

  async function apply() {
    setSaving(true); setError(null); setResult(null)
    try {
      const res = await post<{ adjusted: number; unchanged: number }>('/api/inventory/count', {
        rows: filled.map(i => ({ item_id: i.id, actual: actualBase(i) })),
      })
      setResult(`Пересчитано: ${res.adjusted + res.unchanged}, скорректировано: ${res.adjusted}`)
      setFacts({})
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] text-[#9a9a95]">
          Впишите фактическое количество там, где пересчитали. Пустые строки не трогаются.
        </div>
        <div className="flex items-center gap-2">
          {filled.length > 0 && (
            <span className="text-[13px] text-[#9a9a95]">заполнено {filled.length}, расхождений {changed.length}</span>
          )}
          <button className={BTN} onClick={() => setFacts({})} disabled={!filled.length}>Очистить</button>
          <button className={BTN_P} onClick={apply} disabled={!canWrite || saving || !filled.length}>
            {saving ? 'Провожу…' : 'Провести инвентаризацию'}
          </button>
        </div>
      </div>

      {result && <div className="text-[13px] text-emerald-700 mb-2">{result}</div>}
      {error  && <div className="text-[13px] text-red-600 mb-2">{error}</div>}

      <div className="overflow-x-auto border border-[#e4e4e0] rounded-lg bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-[#9a9a95] border-b border-[#e4e4e0]">
              <th className="text-left  font-normal px-3 py-2">Позиция</th>
              <th className="text-left  font-normal px-3 py-2 w-32">Место</th>
              <th className="text-right font-normal px-3 py-2 w-44">По системе</th>
              <th className="text-right font-normal px-3 py-2 w-48">Факт</th>
              <th className="text-right font-normal px-3 py-2 w-32">Разница</th>
            </tr>
          </thead>
          <tbody>
            {items.map(i => {
              const actual = actualBase(i)
              const diff   = actual === null ? null : Math.round((actual - i.qty) * 10000) / 10000
              const hasPack = !!i.pack_label && i.pack_size > 0
              const usePack = inPack[i.id] ?? hasPack
              return (
                <tr key={i.id} className="border-b border-[#e4e4e0] last:border-0 hover:bg-[#f5f5f3]">
                  <td className="px-3 py-2 text-[#111110]">{i.name}</td>
                  <td className="px-3 py-2 text-[#9a9a95]">{i.location || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {describeQty(i.qty, i.unit, i.pack_label, i.pack_size)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end">
                      <input className={`${INPUT} w-24 text-right`} inputMode="decimal" disabled={!canWrite}
                        value={facts[i.id] ?? ''}
                        onChange={e => setFacts(prev => ({ ...prev, [i.id]: e.target.value }))} />
                      {hasPack ? (
                        <button type="button" className="text-[11px] text-[#9a9a95] border border-[#e4e4e0] rounded px-1.5"
                          onClick={() => setInPack(prev => ({ ...prev, [i.id]: !usePack }))}>
                          {usePack ? i.pack_label : UNIT_LABELS[i.unit]}
                        </button>
                      ) : (
                        <span className="text-[11px] text-[#9a9a95] self-center w-10">{UNIT_LABELS[i.unit]}</span>
                      )}
                    </div>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${
                    diff === null ? 'text-[#9a9a95]' : diff === 0 ? 'text-[#9a9a95]' : diff > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {diff === null ? '—' : diff === 0 ? 'сходится' : `${diff > 0 ? '+' : ''}${diff} ${UNIT_LABELS[i.unit]}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
