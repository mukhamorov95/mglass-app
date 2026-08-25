import { describe, it, expect } from 'vitest'
import { buildDataHealth, type TierInput } from '@/lib/configurator/dataHealth'
import { defaultKitFor, type Library } from '@/lib/configurator/kit'
import { M_MODELS, getModel } from '@/lib/configurator/arrangement'
import { FINISH_IDS } from '@/lib/configurator/pricing'

// СТРУКТУРНЫЕ тесты: проверяем, что отчёт правильно РАЗЛИЧАЕТ полноту, а не что боевые
// данные полны. Красный CI от пустого премиума быть НЕ должен — премиум тут пуст намеренно,
// и тест это подтверждает как норму, не как провал.
const RATES = { glassPerM2: { clear: 3000, crystal: 6000, bronze: 4800, graphite: 4800 }, installPerSection: 5000, deliveryMoscow: 4000, liftPerFloor: 0 }
const FIN = { budget: { marginPct: 40, taxPct: 12, minMarginPct: 25 }, premium: { marginPct: 50, taxPct: 12, minMarginPct: 30 } }
const allColors = (n: number) => Object.fromEntries(FINISH_IDS.map(f => [f, n]))
const FULL: Library = { items: [
  { id: 'h', name: 'Петля', role: 'hinge', prices: allColors(2988) },
  { id: 'ha', name: 'Ручка', role: 'handle', prices: allColors(292) },
  { id: 'hs', name: 'Ручка-купе', role: 'handle-slide', prices: allColors(1200) },
  { id: 'r', name: 'Ролик', role: 'roller', prices: allColors(900) },
  { id: 'mw', name: 'К стене', role: 'mount-wall', prices: allColors(352) },
  { id: 'mg', name: 'К стеклу', role: 'mount-glass', prices: allColors(622) },
  { id: 'mc', name: 'Угловое', role: 'mount-corner', prices: allColors(570) },
  { id: 'cn', name: 'Соединитель', role: 'connector', prices: allColors(430) },
  { id: 'ce', name: 'Заглушка торцевая', role: 'cap-end', prices: allColors(98) },
  { id: 'cp', name: 'Заглушка погонная', role: 'cap', stocks: [{ len: 1000, prices: allColors(158) }] },
  { id: 's1', name: 'Магнитный', role: 'seal-magnet', stocks: [{ len: 2200, prices: allColors(1028) }] },
  { id: 's2', name: 'Нижний', role: 'seal-bottom', stocks: [{ len: 2200, prices: allColors(262) }] },
  { id: 's3', name: 'Петлевой', role: 'seal-hinge', stocks: [{ len: 2200, prices: allColors(202) }] },
  { id: 'p', name: 'Профиль', role: 'profile', stocks: [{ len: 2200, prices: allColors(712) }, { len: 3000, prices: allColors(900) }] },
  { id: 't', name: 'Труба', role: 'tube', stocks: [{ len: 2000, prices: allColors(2175) }, { len: 3000, prices: allColors(3000) }] },
] }
const kitsFrom = (lib: Library) => Object.fromEntries(M_MODELS.map(m => [m.code, defaultKitFor(getModel(m.code), lib)]))
const tin = (lib: Library): TierInput => ({ library: lib, kits: kitsFrom(lib), rates: RATES })

describe('здоровье данных', () => {
  it('полный бюджет + пустой премиум: бюджет продаёт всё, премиум помечен пустым', () => {
    const h = buildDataHealth({ budget: tin(FULL), premium: tin({ items: [] }) }, FIN)
    const b = h.tiers.find(t => t.tier === 'budget')!
    const p = h.tiers.find(t => t.tier === 'premium')!
    expect(b.ready).toBe(b.total)
    expect(p.empty).toBe(true)
    expect(h.sellableTotal).toBe(h.modelsTotal)   // хотя бы в одном тарифе продаётся всё
    expect(h.toFill.some(t => t.tier === 'premium' && t.title.includes('пуст'))).toBe(true)
  })

  it('нет роликов: раздвижные попадают в «что завести», сортировка по влиянию', () => {
    const noRoller: Library = { items: FULL.items.filter(i => i.role !== 'roller') }
    const h = buildDataHealth({ budget: tin(noRoller), premium: tin(noRoller) }, FIN)
    const rollerGap = h.toFill.find(t => t.reason === 'нет позиции' && t.affects.length >= 4)
    expect(rollerGap).toBeDefined()
    expect(rollerGap!.affects).toEqual(expect.arrayContaining(['М8', 'М9', 'М10', 'М12']))
    // impact-сортировка: элемент, задевающий больше моделей, стоит раньше менее влиятельного
    const impacts = h.toFill.filter(t => t.impact > 0).map(t => t.impact)
    expect(impacts).toEqual([...impacts].sort((a, b) => b - a))
  })

  it('clientSees честно: продаётся → «цена», дыра → «по запросу»', () => {
    const noRoller: Library = { items: FULL.items.filter(i => i.role !== 'roller') }
    const h = buildDataHealth({ budget: tin(noRoller), premium: tin(noRoller) }, FIN)
    const b = h.tiers.find(t => t.tier === 'budget')!
    expect(b.models.find(m => m.code === 'М10')!.clientSees).toBe('по запросу')
    expect(b.models.find(m => m.code === 'М7')!.clientSees).toBe('цена')
  })

  it('полные данные в обоих тарифах — список «что завести» пуст (CI зелёный)', () => {
    const h = buildDataHealth({ budget: tin(FULL), premium: tin(FULL) }, FIN)
    expect(h.toFill).toEqual([])
  })
})
