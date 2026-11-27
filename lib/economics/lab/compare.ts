import { calcItem } from '../../b2bCalculator'
import type { B2BMaterial } from '../../types'
import type { B2BRates } from '../../b2b/rates'
import { layersOf, type LabPosition } from './project'

// Действующая модель на тех же входных данных. Калькулятор B2B вызывается как есть: его цены,
// ставки и справочники не меняются. Резка, сверление, вырезы и пескоструй в нём считаются
// выбранными услугами, а не нормами, поэтому без выбранных услуг их у него нет — и в сравнении
// это «отсутствует», а не ноль.
export type LegacyPosition = {
  positionId: string
  ok: boolean
  why?: string
  costMaterial: number
  costTempering: number
  costFacet: number
  costEdge: number
  costTransport: number
  costPackaging: number
  costWithVat: number
  costExVat: number
  saleIncVat: number
  saleExVat: number
  marginPct: number
  billedM2: number
  wholeSheets: number | null
  minPriceApplied: boolean
}

export type Legacy = {
  positions: LegacyPosition[]
  totals: {
    costMaterial: number; costTempering: number; costFacet: number; costEdge: number
    costTransport: number; costPackaging: number; costWithVat: number; costExVat: number
    saleIncVat: number; saleExVat: number
  }
  absent: string[]        // что действующая модель на этих входных данных не считает
  notes: string[]
}

const ABSENT = [
  'Резка — в действующей модели это выбранная услуга, а не норма времени',
  'Сверление — выбранная услуга',
  'Вырезы — выбранная услуга',
  'Пескоструй — выбранная услуга',
  'Человеко-часы и станко-часы — не рассчитываются',
  'Наладка партии и серийность — не рассчитываются',
]

export function legacyModel(positions: LabPosition[], materials: B2BMaterial[], rates: B2BRates): Legacy {
  const out: LegacyPosition[] = []
  const notes: string[] = []
  for (const p of positions) {
    const mat = materials.find(m => m.id === p.materialId)
    if (!mat || !p.widthMm || !p.heightMm || !(p.qty > 0)) {
      out.push({
        positionId: p.id, ok: false,
        why: !mat ? 'материал не выбран или его нет в справочнике' : 'нет размеров или количества',
        ...zero(),
      })
      continue
    }
    if (p.thicknessMm != null && p.thicknessMm !== mat.thickness) {
      notes.push(`позиция ${p.id}: толщина ${p.thicknessMm} мм не совпадает с материалом справочника (${mat.thickness} мм) — действующая модель считает по материалу`)
    }
    const layers = layersOf(p)
    const r = calcItem(
      mat, p.widthMm, p.heightMm, p.qty, mat.waste_percent, p.tempering, [], p.facet, null, [],
      layers > 1, layers, null, [], true, rates,
    )
    out.push({
      positionId: p.id, ok: true,
      costMaterial: r.costMaterial, costTempering: r.costTempering, costFacet: r.costFacet,
      costEdge: r.costEdge, costTransport: r.costTransport, costPackaging: r.costPackaging,
      costWithVat: r.costWithVat, costExVat: r.costExVat,
      saleIncVat: r.saleIncVat, saleExVat: r.saleExVat, marginPct: r.margin,
      billedM2: r.totalAreaBilled, wholeSheets: r.wholeSheets ?? null,
      minPriceApplied: !!r.minPriceApplied,
    })
  }
  const sum = (f: (x: LegacyPosition) => number) => out.filter(x => x.ok).reduce((a, x) => a + f(x), 0)
  return {
    positions: out,
    totals: {
      costMaterial: sum(x => x.costMaterial), costTempering: sum(x => x.costTempering),
      costFacet: sum(x => x.costFacet), costEdge: sum(x => x.costEdge),
      costTransport: sum(x => x.costTransport), costPackaging: sum(x => x.costPackaging),
      costWithVat: sum(x => x.costWithVat), costExVat: sum(x => x.costExVat),
      saleIncVat: sum(x => x.saleIncVat), saleExVat: sum(x => x.saleExVat),
    },
    absent: ABSENT,
    notes,
  }
}

const zero = () => ({
  costMaterial: 0, costTempering: 0, costFacet: 0, costEdge: 0, costTransport: 0, costPackaging: 0,
  costWithVat: 0, costExVat: 0, saleIncVat: 0, saleExVat: 0, marginPct: 0, billedM2: 0,
  wholeSheets: null, minPriceApplied: false,
})
