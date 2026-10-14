import type { QuoteItemInput } from '@/lib/b2b/computeQuote'
import { MAX_HOLE_D_MM, type PartGeometry } from './types'

// Поля называются как в QuoteItemInput — расхождение имён ловит компилятор.
export type QuoteFacts = Required<Pick<QuoteItemInput, 'width' | 'height' | 'shape' | 'holes' | 'hasHoles' | 'cutouts' | 'hasCutouts'>>

export function geometryToQuoteFacts(geom: PartGeometry): QuoteFacts {
  const byD = new Map<number, number>()
  let bigRound = 0
  for (const h of geom.holes) {
    // Разбор DXF уже кладёт такие круги в вырезы; здесь — страховка для любой другой геометрии.
    if (h.d > MAX_HOLE_D_MM) { bigRound++; continue }
    const d = Math.round(h.d * 2) / 2
    byD.set(d, (byD.get(d) ?? 0) + 1)
  }
  const holes = [...byD.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => ({ d, n }))
  const cutouts = geom.cutouts.length + bigRound
  return {
    width: Math.round(geom.width * 10) / 10,
    height: Math.round(geom.height * 10) / 10,
    shape: geom.shape,
    holes,
    hasHoles: holes.length > 0,
    cutouts,
    hasCutouts: cutouts > 0,
  }
}
