import { describe, it, expect } from 'vitest'
import { auditKits } from '@/lib/configurator/audit'
import { defaultKitFor, type Library, type ModelKit, type KitRates } from '@/lib/configurator/kit'
import { M_MODELS, getModel } from '@/lib/configurator/arrangement'
import { FINISH_IDS } from '@/lib/configurator/pricing'

const RATES: KitRates = { glassPerM2: { clear: 3000, crystal: 6000, bronze: 4800, graphite: 4800 }, installPerSection: 5000, deliveryMoscow: 4000, liftPerFloor: 0 }
const FIN = { marginPct: 40, taxPct: 12, minMarginPct: 25 }
const allColors = (n: number) => Object.fromEntries(FINISH_IDS.map(f => [f, n]))

// Библиотека, покрывающая все роли всех моделей во всех цветах.
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
const kitsFrom = (lib: Library): Record<string, ModelKit> =>
  Object.fromEntries(M_MODELS.map(m => [m.code, defaultKitFor(getModel(m.code), lib)]))

describe('аудит комплектов', () => {
  it('полная библиотека — все модели продаваемы, дыр нет', () => {
    const r = auditKits(FULL, kitsFrom(FULL), RATES, FIN)
    expect(r.total).toBe(M_MODELS.length)
    expect(r.ready).toBe(r.total)
    expect(r.libraryIssues).toEqual([])
  })

  it('нет роликов — раздвижные модели непродаваемы, распашные не страдают', () => {
    const lib: Library = { items: FULL.items.filter(i => i.role !== 'roller') }
    const r = auditKits(lib, kitsFrom(lib), RATES, FIN)
    const bad = r.models.filter(m => !m.sellable).map(m => m.code)
    expect(bad).toContain('М10')
    expect(bad).not.toContain('М7')
    expect(r.models.find(m => m.code === 'М10')!.issues.some(i => i.role === 'roller')).toBe(true)
  })

  it('позиция без цены в одном цвете — предупреждение по библиотеке', () => {
    const lib: Library = { items: FULL.items.map(i => i.id === 'ha' ? { ...i, prices: { chrome: 292 } } : i) }
    const r = auditKits(lib, kitsFrom(lib), RATES, FIN)
    expect(r.libraryIssues.some(i => i.code === 'нет цены в цвете' && i.label === 'Ручка')).toBe(true)
  })

  it('короткий хлыст — на максимальном размере вылезает негабарит, на минимальном нет', () => {
    const lib: Library = { items: FULL.items.map(i => i.id === 'p' ? { ...i, stocks: [{ len: 1200, prices: allColors(400) }] } : i) }
    const r = auditKits(lib, kitsFrom(lib), RATES, FIN)
    expect(r.models.some(m => m.issues.some(i => i.code === 'кусок длиннее хлыста'))).toBe(true)
  })

  it('маржа ниже минимума — модель непродаваема', () => {
    const kits = kitsFrom(FULL)
    kits['М7'].margin = 10
    const r = auditKits(FULL, kits, RATES, FIN)
    expect(r.models.find(m => m.code === 'М7')!.sellable).toBe(false)
  })

  it('нет цены стекла — блокер по библиотеке', () => {
    const r = auditKits(FULL, kitsFrom(FULL), { ...RATES, glassPerM2: { clear: 3000 } }, FIN)
    expect(r.libraryIssues.some(i => i.code === 'нет цены стекла')).toBe(true)
  })
})
