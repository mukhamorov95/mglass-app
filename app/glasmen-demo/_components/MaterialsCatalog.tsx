'use client'

import Link from 'next/link'
import { glassRules } from '@/lib/glasmen'
import { useMaterials } from './useMaterials'
import { categoryTitle, groupMaterials } from './groupMaterials'
import { canTemper, isMirror, num, rub, VAT_LABEL, type DemoMaterial } from './api'
import { LoadError, Skeleton } from './States'
import { Warnings } from './PricePanel'

function Limits({ m }: { m: DemoMaterial }) {
  const mirror = isMirror(m)
  const temper = canTemper(m)
  const r = glassRules(m.thickness, temper, { category: mirror ? 'mirror' : 'glass' })
  const kg = m.thickness * (r.kgPerM2PerMm ?? 0)
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-[#55554f] sm:grid-cols-3">
      <div><dt className="inline text-[#9a9a95]">Отверстие ≥ </dt><dd className="inline">Ø{num(r.minHoleD)} мм</dd></div>
      <div><dt className="inline text-[#9a9a95]">До кромки ≥ </dt><dd className="inline">{num(r.minHoleEdge)} мм</dd></div>
      <div><dt className="inline text-[#9a9a95]">До угла ≥ </dt><dd className="inline">{num(r.minHoleCorner)} мм</dd></div>
      <div><dt className="inline text-[#9a9a95]">Между отв. ≥ </dt><dd className="inline">{num(r.minHoleHole)} мм</dd></div>
      <div><dt className="inline text-[#9a9a95]">Радиус выреза ≥ </dt><dd className="inline">R{num(r.minCutoutInnerRadius)} мм</dd></div>
      <div><dt className="inline text-[#9a9a95]">Вес ≈ </dt><dd className="inline">{num(kg, 1)} кг/м²</dd></div>
      <div className="col-span-2 sm:col-span-3">
        <dt className="inline text-[#9a9a95]">{temper ? 'Под закалку: ' : 'Размер: '}</dt>
        <dd className="inline">
          {num(r.minSide)}…{num(r.maxLong)}×{num(r.maxShort)} мм
          {temper ? ' (печь закалки)' : mirror ? ' (лист; зеркало не закаливается)' : ' (лист; не закаливается)'}
          {m.temperable === null && !mirror && <span className="text-amber-700"> · закаляемость не подтверждена</span>}
        </dd>
      </div>
    </dl>
  )
}

export default function MaterialsCatalog() {
  const { data, error, done, retry } = useMaterials()
  if (!done) return <Skeleton rows={4} />
  if (error || !data) return <LoadError what="материалы" reason={error ?? 'нет данных'} onRetry={retry} />
  const groups = groupMaterials(data.materials)

  return (
    <div className="space-y-6">
      <p className="text-[13px] text-[#55554f]">
        {data.combos} сочетаний материал × толщина. Цена за м² — общий прайс, {VAT_LABEL}, до скидки; закалка, кромка, сверление и вырезы входят, фацет и триплекс — отдельно.
      </p>
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
        Пределы по отверстиям, отступам, радиусам, весу и размерам — черновик по общей практике закалки стекла, ждёт технолога. Те же числа применяет проверка в «Расчёте».
      </p>
      <Warnings list={data.warnings} />
      {groups.map(g => (
        <section key={g.category}>
          <h2 className="mb-2 text-[16px] font-semibold tracking-tight">{categoryTitle(g.category)}</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {g.families.map(f => (
              <article key={f.key} className="rounded-2xl border border-[#e4e4e0] bg-white p-4">
                <h3 className="text-[15px] font-medium">{f.name}</h3>
                <ul className="mt-2 divide-y divide-[#f0f0ed]">
                  {f.items.map(m => (
                    <li key={m.id} className="py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-medium">{num(m.thickness)} мм</span>
                        <span className="text-[13px] tabular-nums">{rub(m.pricePerM2)}<span className="text-[#9a9a95]">/м²</span></span>
                      </div>
                      <div className="mt-1"><Limits m={m} /></div>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ))}
      <Link href="/glasmen-demo/quote" className="inline-block rounded-xl bg-[#111110] px-5 py-3 text-[14px] font-medium text-white hover:bg-black">
        Загрузить чертёж или задать размеры — увидеть цену
      </Link>
    </div>
  )
}
