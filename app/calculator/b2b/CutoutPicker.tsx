'use client'

import { CUTOUT_TYPES, cutoutCode, cutoutRow, type CutoutGroup } from '@/lib/b2b/cutouts'
import type { B2BService } from '@/lib/types'

type Props = {
  groups: CutoutGroup[]
  onChange: (g: CutoutGroup[]) => void
  prices: (B2BService & { code?: string | null })[]
  canEditPrices?: boolean
}

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

// Выбор вырезов позиции: вид × категория × сколько на одну деталь. Цена за штуку — из
// справочника; не задана — строка красная, и позиция не добавится (проверка у вызывающего).
export default function CutoutPicker({ groups, onChange, prices, canEditPrices }: Props) {
  const set = (i: number, patch: Partial<CutoutGroup>) => onChange(groups.map((g, k) => (k === i ? { ...g, ...patch } : g)))
  const add = () => {
    const used = new Set(groups.map(cutoutCode))
    const next = CUTOUT_TYPES.find(t => !used.has(t.code)) ?? CUTOUT_TYPES[0]
    onChange([...groups, { kind: next.kind, cat: next.cat, n: 1 }])
  }
  return (
    <div className="space-y-1.5">
      {groups.map((g, i) => {
        const row = cutoutRow(prices, g)
        const price = Number(row?.value) || 0
        return (
          <div key={i} className="flex items-center gap-1.5 min-w-0">
            <select
              value={cutoutCode(g)}
              onChange={e => {
                const t = CUTOUT_TYPES.find(x => x.code === e.target.value)
                if (t) set(i, { kind: t.kind, cat: t.cat })
              }}
              className="min-w-0 flex-1 bg-white border border-blue-200 rounded-lg px-2 min-h-[40px] lg:min-h-[34px] text-[13px] text-[#111110] outline-none focus:border-blue-500">
              {CUTOUT_TYPES.map(t => <option key={t.code} value={t.code}>{t.label.replace('Вырез ', '').replace(' кат.', '').replace('внутренний', 'внутр.')}</option>)}
            </select>
            <input
              type="number" min={1} inputMode="numeric" value={g.n || ''} aria-label="Вырезов на деталь"
              onChange={e => set(i, { n: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              className="w-14 bg-white border border-blue-200 rounded-lg px-2 min-h-[40px] lg:min-h-[34px] text-[13px] text-right outline-none focus:border-blue-500" />
            <span className={`w-24 text-right text-[12px] tabular-nums ${price > 0 ? 'text-[#6b6b66]' : 'text-red-600 font-medium'}`}
              title={price > 0 ? 'Цена за один вырез из справочника' : 'В справочнике вырезов нет продажной цены'}>
              {price > 0 ? `${rub(price)}/шт` : 'нет цены'}
            </span>
            <button type="button" onClick={() => onChange(groups.filter((_, k) => k !== i))}
              className="w-8 min-h-[40px] lg:min-h-[34px] text-[#9a9a95] hover:text-red-600" aria-label="Убрать вырез">✕</button>
          </div>
        )
      })}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={add}
          className="text-[12px] font-medium text-blue-700 hover:text-blue-900 min-h-[32px]">＋ вырез</button>
        {groups.length > 0 && (
          <a href="/admin/cutouts" target="_blank" rel="noreferrer" className="text-[11px] text-[#9a9a95] hover:text-[#111110]">
            {canEditPrices ? 'цены вырезов →' : 'справочник вырезов →'}
          </a>
        )}
      </div>
      {groups.length > 0 && <p className="text-[11px] text-[#9a9a95] leading-snug">Количество — на одну деталь. Внешний — по краю стекла, внутренний — внутри поля.</p>}
    </div>
  )
}
