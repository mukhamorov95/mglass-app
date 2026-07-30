import type { B2BMaterial } from './types'

// Подготовка прайса материалов ТОЧНО как в менеджерском калькуляторе
// (app/calculator/b2b/page.tsx): sale из notes.sale_price, перекрытие продажной
// цены и отхода из glass_price_matrix, дедуп по name|category|thickness с
// приоритетом «есть цена». Вынесено, чтобы партнёрский расчёт считал 1:1.

function parseSale(m: B2BMaterial): B2BMaterial {
  try {
    if (m.notes) { const n = JSON.parse(m.notes); return { ...m, sale_price: n?.sale_price ?? 0, passthrough: n?.passthrough ?? false } }
  } catch {}
  return { ...m, sale_price: 0, passthrough: false }
}

export function prepPricedMaterials(mats: B2BMaterial[], matrix: Array<Record<string, unknown>>): B2BMaterial[] {
  const parsed = mats.map(m => {
    const base = parseSale(m)
    const mm = Math.round(m.thickness)
    const cat = m.category === 'зеркало' ? 'mirror' : 'glass'
    const mSale = matrix.find(r => r.name === m.name && r.category === cat && r.price_type === 'sale')
    const mCost = matrix.find(r => r.name === m.name && r.category === cat && r.price_type === 'cost')
    const matrixPrice = mSale ? (mSale[`t${mm}`] as number | null) : null
    const matrixWaste = (mCost?.waste_pct as number | null) ?? null
    return {
      ...base,
      ...(matrixPrice != null && matrixPrice > 0 ? { sale_price: matrixPrice } : {}),
      ...(matrixWaste != null && matrixWaste > 0 ? { waste_percent: matrixWaste, passthrough: false } : {}),
    }
  })
  const dedup = new Map<string, B2BMaterial>()
  for (const m of parsed) {
    const k = `${m.name}|${m.category}|${m.thickness}`
    const prev = dedup.get(k)
    if (!prev || (m.sale_price ?? 0) > (prev.sale_price ?? 0)) dedup.set(k, m)
  }
  return [...dedup.values()].filter(m => (m.sale_price ?? 0) > 0)
}
