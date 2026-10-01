import { describe, it, expect } from 'vitest'
import { computeKitQuantities, computeKitPrice, normalizeKit, type Library, type KitRates, type ModelKit } from '@/lib/configurator/kit'
import { buildWithVariant } from '@/lib/configurator/quoteContract'
import { M_MODELS } from '@/lib/configurator/arrangement'
import live from '../fixtures/configurator/budget-live-2026-10-01.json'

// Регрессионные ворота маршрута SHOWROOM_COST_ROUTE: живая библиотека budget на 01.10,
// 9 моделей × 3 ширины × {хром, чёрный}. Любая правка движка, которая сдвигает итог,
// меняет снимок — в PR это перечисляется и объясняется. Фикстура — данные, а не код:
// при правках библиотеки в админке её не обновляют.

const LIB = live.library as Library
const KITS = live.kits as Record<string, unknown>
const RATES = live.rates as KitRates
const FIN = live.finance as { marginPct: number; taxPct: number; minMarginPct?: number }

const step = (a: number, b: number, k: number) => Math.round((a + (b - a) * k) / 10) * 10

describe('Снимок budget-итогов (данные 01.10)', () => {
  for (const model of M_MODELS) {
    const kit = normalizeKit(KITS[model.code]) ?? ({ slots: [] } as ModelKit)
    const c = model.constraints
    for (const k of [0, 0.5, 1]) {
      const dims = {
        width: step(c.width[0], c.width[1], k),
        height: Math.min(2000, c.height[1]),
        width2: c.needsWidth2 && c.width2 ? step(c.width2[0], c.width2[1], 0.5) : undefined,
        doorWidth: c.doorWidth ? step(c.doorWidth[0], c.doorWidth[1], 0.5) : undefined,
      }
      for (const finishId of ['chrome', 'black']) {
        it(`${model.code} ${dims.width}${dims.width2 ? '×' + dims.width2 : ''} ${finishId}`, () => {
          const assembly = buildWithVariant(model, dims, model.thickness[0] ?? 8)
          const q = computeKitQuantities(assembly, model.thickness[0] ?? 8, model, RATES.capMargin)
          const p = computeKitPrice(q, LIB, kit, RATES, FIN, { finishId, withDelivery: false })
          expect({
            hardware: Math.round(p.hardwareCost),
            complete: p.complete,
            missing: p.missing.map(m => `${m.role}:${m.reason}`).sort(),
            lines: p.lines.map(l => `${l.role} ${l.itemId}×${l.qty}=${Math.round(l.total)}`),
          }).toMatchSnapshot()
        })
      }
    }
  }
})
