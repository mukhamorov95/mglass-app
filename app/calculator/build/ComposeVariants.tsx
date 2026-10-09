'use client'

import type { FinishId } from '@/lib/configurator/catalog'
import { SUPPLIER_RU } from '@/lib/calc/composition'
import type { CatalogModel } from '@/lib/calc/compositionCatalog'
import { Thumb } from './ComposeThumb'

// Чем заменить выбранную деталь (CONSTRUCTOR_ROUTE.md, К9 В1): та же разновидность — кноб на
// кноб, петля стекло-стекло 180° на такую же. Касание меняет деталь в строке; количество и места
// на схеме остаются. Цена изделия пересчитывается сервером, здесь — только закупка из каталога.

const RUBk = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`

export function Variants({ current, alts, finishId, kindLabel, inUse, onSwap, onAll, limit = 7, cols = 'grid-cols-4 md:grid-cols-8' }: {
  current: CatalogModel
  alts: CatalogModel[]
  finishId: FinishId
  kindLabel: string
  inUse: (m: CatalogModel) => boolean      // уже другая строка состава — замена сделала бы дубль
  onSwap: (m: CatalogModel) => void
  onAll: () => void
  limit?: number
  cols?: string                            // сетка зависит от того, где стоит панель: узкая колонка или во всю ширину
}) {
  const shown = [current, ...alts.slice(0, limit)]
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-[#4b4b47]"><b className="text-[#111110]">Заменить на</b> · {kindLabel}</span>
        <button onClick={onAll} className="text-[12px] text-[#2563eb] hover:underline shrink-0">Все {alts.length} →</button>
      </div>
      <div className={`grid ${cols} gap-1.5`}>
        {shown.map(m => {
          const v = m.variants[finishId]
          const now = m === current
          const busy = !now && inUse(m)
          return (
            <button key={`${m.supplier}|${m.base}`} onClick={() => !now && !busy && onSwap(m)} disabled={busy}
              title={`${m.name} · ${SUPPLIER_RU[m.supplier]}`}
              className={`relative text-left bg-white rounded-lg border p-1 flex flex-col gap-0.5 transition-colors disabled:opacity-40 ${now ? 'border-[#111110] ring-1 ring-[#111110]' : 'border-[#e4e4e0] hover:border-[#111110]'}`}>
              <Thumb src={v?.image ?? m.image} alt={m.name} size="w-full aspect-square" />
              {now && <span className="absolute top-1.5 left-1.5 bg-[#111110] text-white text-[9.5px] font-semibold rounded px-1">сейчас</span>}
              {busy && <span className="absolute top-1.5 left-1.5 bg-white text-[#6b6b66] border border-[#e4e4e0] text-[9.5px] rounded px-1">в составе</span>}
              <span className="text-[10.5px] font-mono text-[#111110] leading-tight truncate">{m.base}</span>
              <span className="text-[10px] text-[#9a9a95] leading-tight truncate">{SUPPLIER_RU[m.supplier]}</span>
              <span className="text-[11.5px] font-mono font-semibold text-[#111110]">{v ? RUBk(v.cost) : '—'}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
