'use client'

import Link from 'next/link'
import { useMaterials } from './useMaterials'
import { groupMaterials, categoryTitle } from './groupMaterials'
import { num, plural, rub, VAT_LABEL } from './api'
import { LoadError, Skeleton } from './States'

export default function MaterialsGrid() {
  const { data, error, done, retry } = useMaterials()
  if (!done) return <Skeleton rows={2} />
  if (error || !data) return <LoadError what="материалы" reason={error ?? 'нет данных'} onRetry={retry} />

  const groups = groupMaterials(data.materials)
  return (
    <div className="space-y-5">
      <p className="text-[13px] text-[#55554f]">
        {data.combos} {plural(data.combos, 'сочетание', 'сочетания', 'сочетаний')} материал × толщина в прайсе. Цена за м² — {VAT_LABEL}.
      </p>
      {groups.map(g => (
        <div key={g.category}>
          <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[#9a9a95]">{categoryTitle(g.category)}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {g.families.map(f => {
              const prices = f.items.map(i => i.pricePerM2)
              const lo = Math.min(...prices), hi = Math.max(...prices)
              return (
                <Link key={f.key} href="/glasmen-demo/materials" className="rounded-xl border border-[#e4e4e0] bg-white p-3 transition hover:border-[#111110]">
                  <div className="text-[14px] font-medium">{f.name}</div>
                  <div className="mt-1 text-[12px] text-[#55554f]">
                    {f.items.map(i => `${num(i.thickness)} мм`).join(' · ')}
                  </div>
                  <div className="mt-1 text-[12px] text-[#9a9a95]">
                    {lo === hi ? rub(lo) : `${rub(lo)} – ${rub(hi)}`} за м²
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

