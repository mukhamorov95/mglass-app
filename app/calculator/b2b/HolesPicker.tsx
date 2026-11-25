'use client'

import { holeBand, type HolePrice } from '@/lib/b2b/holePrices'
import type { HoleGroup } from '@/lib/production/holes'

type Props = { groups: HoleGroup[]; onChange: (g: HoleGroup[]) => void; thickness: number; prices: HolePrice[] }

// Отверстия изделия: N штук диаметром D на одну деталь; цена — по диаметру и толщине.
export default function HolesPicker({ groups, onChange, thickness, prices }: Props) {
  const set = (i: number, patch: Partial<HoleGroup>) => onChange(groups.map((g, k) => (k === i ? { ...g, ...patch } : g)))
  return (
    <div className="space-y-1.5">
      {groups.map((g, i) => {
        const band = g.d > 0 ? holeBand(g.d, thickness, prices) : null
        return (
          <div key={i} className="flex items-center gap-1.5">
            <input type="number" min={1} inputMode="numeric" value={g.n || ''} placeholder="шт" aria-label="Отверстий на деталь"
              onChange={e => set(i, { n: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              className="w-14 bg-white border border-blue-200 rounded-lg px-2 min-h-[40px] lg:min-h-[34px] text-[13px] text-right outline-none focus:border-blue-500" />
            <span className="text-[12px] text-[#6b6b66]">шт · ⌀</span>
            <input type="number" min={1} inputMode="numeric" value={g.d || ''} placeholder="мм" aria-label="Диаметр, мм"
              onChange={e => set(i, { d: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              className="w-16 bg-white border border-blue-200 rounded-lg px-2 min-h-[40px] lg:min-h-[34px] text-[13px] text-right outline-none focus:border-blue-500" />
            <span className="text-[12px] text-[#6b6b66]">мм</span>
            <span className={`ml-auto text-[12px] tabular-nums whitespace-nowrap ${band && band.sale > 0 ? 'text-[#6b6b66]' : 'text-red-600 font-medium'}`}>
              {g.d <= 0 ? '' : band && band.sale > 0 ? `${band.sale} ₽/шт` : 'нет цены'}
            </span>
            <button type="button" onClick={() => onChange(groups.filter((_, k) => k !== i))}
              className="w-8 min-h-[40px] lg:min-h-[34px] text-[#9a9a95] hover:text-red-600" aria-label="Убрать отверстия">✕</button>
          </div>
        )
      })}
      <button type="button" onClick={() => onChange([...groups, { d: 0, n: 1 }])}
        className="text-[12px] font-medium text-blue-700 hover:text-blue-900 min-h-[32px]">＋ отверстия</button>
    </div>
  )
}
