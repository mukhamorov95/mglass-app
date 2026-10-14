import MaterialsCatalog from '../_components/MaterialsCatalog'

export const metadata = { title: 'Материалы · GLASMEN демо' }

export default function GlasmenMaterialsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Материалы</h1>
        <p className="mt-1 text-[13px] text-[#55554f]">Что режем: материал × толщина, цена за м² и правила стекла для каждой толщины.</p>
      </div>
      <MaterialsCatalog />
    </div>
  )
}
