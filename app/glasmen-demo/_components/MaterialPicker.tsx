'use client'

import type { DemoMaterial } from './api'
import { canTemper, isMirror, num, rub, VAT_LABEL } from './api'
import { categoryTitle, groupMaterials } from './groupMaterials'

export default function MaterialPicker({
  materials, materialId, onMaterial,
  temperWanted, onTemper, hasFacet, onFacet, facetMm, onFacetMm, facetTypes,
}: {
  materials: DemoMaterial[]
  facetTypes: number[]              // ширины из активных строк facet_prices (GET /api/glasmen-demo/materials)
  materialId: number | null
  onMaterial: (id: number) => void
  temperWanted: boolean
  onTemper: (v: boolean) => void
  hasFacet: boolean
  onFacet: (v: boolean) => void
  facetMm: number | null
  onFacetMm: (v: number) => void
}) {
  const groups = groupMaterials(materials)
  const mat = materials.find(m => m.id === materialId) ?? null
  const cat = mat?.category ?? groups[0]?.category ?? ''
  const fams = groups.find(g => g.category === cat)?.families ?? []
  const fam = fams.find(f => f.name === mat?.name) ?? null
  const temperable = canTemper(mat)
  const temperOn = temperWanted && temperable

  const pickCategory = (c: string) => {
    const f = groups.find(g => g.category === c)?.families[0]
    if (f) onMaterial(f.items[0].id)
  }
  const pickFamily = (name: string) => {
    const f = fams.find(x => x.name === name)
    if (!f) return
    const same = f.items.find(i => i.thickness === mat?.thickness)
    onMaterial((same ?? f.items[0]).id)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {groups.map(g => (
          <button
            key={g.category}
            type="button"
            onClick={() => pickCategory(g.category)}
            className={`rounded-full border px-3 py-1 text-[12px] ${g.category === cat ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white text-[#55554f] hover:border-[#9a9a95]'}`}
          >
            {categoryTitle(g.category)}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-[12px] text-[#55554f]">Материал</span>
        <select
          value={fam?.name ?? ''}
          onChange={e => pickFamily(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[#e4e4e0] bg-white px-2.5 py-2 text-[13px]"
        >
          {!fam && <option value="">— выберите —</option>}
          {fams.map(f => <option key={f.key} value={f.name}>{f.name}</option>)}
        </select>
      </label>

      {fam && (
        <div>
          <div className="text-[12px] text-[#55554f]">Толщина</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {fam.items.map(i => (
              <button
                key={i.id}
                type="button"
                onClick={() => onMaterial(i.id)}
                className={`rounded-lg border px-2.5 py-1.5 text-[12px] ${i.id === materialId ? 'border-[#111110] bg-[#f5f5f3] font-medium' : 'border-[#e4e4e0] bg-white hover:border-[#9a9a95]'}`}
              >
                {num(i.thickness)} мм <span className="text-[#9a9a95]">· {rub(i.pricePerM2)}/м²</span>
              </button>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-[#9a9a95]">Прайс за м² {VAT_LABEL}, до скидки.</div>
        </div>
      )}

      <div className="space-y-2 rounded-xl border border-[#e4e4e0] bg-[#fafaf9] p-3">
        <label className={`flex items-start gap-2 text-[13px] ${temperable ? '' : 'opacity-60'}`}>
          <input type="checkbox" className="mt-0.5 accent-[#111110]" checked={temperOn} disabled={!temperable} onChange={e => onTemper(e.target.checked)} />
          <span>
            Закалка <span className="text-[#9a9a95]">— входит в цену за м²</span>
            {!temperable && mat && (
              <span className="block text-[12px] text-[#9a9a95]">
                {isMirror(mat) ? 'Зеркало не закаливается.' : 'Этот материал не закаливается.'}
              </span>
            )}
            {temperable && mat?.temperable === null && (
              <span className="block text-[12px] text-amber-700">Закаляемость этой толщины не подтверждена: нет ставки закалки в справочнике.</span>
            )}
          </span>
        </label>
        <div className={`flex flex-wrap items-center gap-2 text-[13px] ${facetTypes.length ? '' : 'opacity-60'}`}>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-[#111110]" checked={hasFacet && facetTypes.length > 0} disabled={!facetTypes.length} onChange={e => onFacet(e.target.checked)} />
            Фацет <span className="text-[#9a9a95]">— доплата за п. м периметра</span>
          </label>
          {hasFacet && facetTypes.length > 0 && facetMm !== null && (
            <select value={facetMm} onChange={e => onFacetMm(Number(e.target.value))} className="rounded-lg border border-[#e4e4e0] bg-white px-2 py-1 text-[12px]" aria-label="Ширина фацета">
              {facetTypes.map(f => <option key={f} value={f}>{f} мм</option>)}
            </select>
          )}
          {!facetTypes.length && <span className="block w-full text-[12px] text-[#9a9a95]">Нет активных ставок фацета в справочнике — посчитать фацет нельзя.</span>}
        </div>
      </div>
    </div>
  )
}
