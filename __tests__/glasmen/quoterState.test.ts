import { describe, it, expect } from 'vitest'
import { parseOnce, priceGate, readSnapshot, storable, stripOverride, unitsPendingFor, type Dxf } from '@/app/glasmen-demo/_components/quoterState'
import { parseDxf } from '@/lib/glasmen/dxf'
import { dxf, insert, ln, rectLw } from './fixtures'

const bomb = () => {
  const blocks = [
    { name: 'L0', ents: [rectLw(0, 0, 10, 10)] },
    ...[1, 2, 3].map(i => ({ name: `L${i}`, ents: Array.from({ length: 50 }, (_, k) => insert(`L${i - 1}`, k * 20, 0)) })),
  ]
  return dxf(Array.from({ length: 50 }, (_, k) => insert('L3', 0, k * 20)), { blocks })
}
const saved = (d: Partial<Dxf> & { text: string }, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ tab: 'dxf', dxf: { name: 'a.dxf', units: null, ...d }, ...extra })

describe('черновик расчёта: «отравленный» DXF не переживает перезагрузку', () => {
  it('сохранённый чертёж-бомба убирается из черновика при чтении, быстро и с именем файла', () => {
    const text = bomb()
    const t = performance.now()
    const { snap, droppedDxf } = readSnapshot(null, saved({ text, name: 'bomb.dxf' }))
    expect(performance.now() - t).toBeLessThan(1000)
    expect(snap.dxf).toBeNull()
    expect(droppedDxf).toBe('bomb.dxf')
    expect(snap.tab).toBe('dxf')
  })

  it('чертёж с «1e400» тоже убирается', () => {
    const text = dxf([rectLw(0, 0, 100, 100), ln(0, 0, '1e400' as unknown as number, 1)])
    expect(readSnapshot(null, saved({ text })).snap.dxf).toBeNull()
  })

  it('нормальный чертёж и подтверждённые единицы (см) сохраняются как были', () => {
    const text = dxf([rectLw(0, 0, 100, 60)], { insunits: null })
    const { snap, droppedDxf } = readSnapshot(null, saved({ text, units: 'cm' }))
    expect(droppedDxf).toBeNull()
    expect(snap.dxf).toEqual({ text, name: 'a.dxf', units: 'cm' })
  })

  it('неизвестные единицы в черновике → «не подтверждены»; битый JSON → значения по умолчанию', () => {
    const text = dxf([rectLw(0, 0, 100, 60)])
    expect(readSnapshot(null, saved({ text, units: 'parsec' as never })).snap.dxf?.units).toBeNull()
    const d = readSnapshot('size', '{oops')
    expect(d.snap.tab).toBe('size')
    expect(d.snap.dxf).toBeNull()
    expect(d.droppedDxf).toBeNull()
  })

  it('storable: только разбор без too_complex и bad_numbers', () => {
    expect(storable(parseOnce(dxf([rectLw(0, 0, 100, 60)]), 'ok', null))).toBe(true)
    expect(storable(parseOnce(bomb(), 'b', null))).toBe(false)
    expect(storable({ geom: null, failed: 'x' })).toBe(false)
  })

  it('parseOnce: один разбор на текст и единицы, исключение — результат, а не падение', () => {
    const text = dxf([rectLw(0, 0, 300, 200)])
    const a = parseOnce(text, 'p', null)
    expect(parseOnce(text, 'p', null)).toBe(a)
    expect(parseOnce(text, 'p', 'cm')).not.toBe(a)
    expect(parseOnce(text, 'p', 'cm').geom?.width).toBeCloseTo(3000, 6)
    expect(a.geom).toEqual(parseDxf(text, { name: 'p' }))
    const bad = parseOnce(null as unknown as string, 'x', null)
    expect(bad.geom).toBeNull()
    expect(bad.failed).toBeTruthy()
  })

  it('из черновика не уходит ladderAppliesToTempering (галочку снять нельзя)', () => {
    expect(stripOverride({ k: 1.01, ladderAppliesToTempering: false })).toEqual({ k: 1.01 })
    const { snap } = readSnapshot(null, JSON.stringify({ overrides: { ladderB: { ladderAppliesToTempering: false, M: 2000 } } }))
    expect(snap.overrides.ladderB).toEqual({ M: 2000 })
  })
})

describe('показ цены: единицы и черновые правила стекла', () => {
  const ok = { matsDone: true, hasMaterial: true, tab: 'dxf' as const, hasDxf: true, hasFacts: true, unitsPending: false, hardCount: 0 }

  it('всё в порядке — цена и кнопка доступны', () => {
    expect(priceGate(ok)).toEqual({ blocked: null, hardNote: null, addReason: null })
  })

  it('единицы не подтверждены — цены нет, причина названа', () => {
    const g = priceGate({ ...ok, unitsPending: true })
    expect(g.blocked).toBe('Подтвердите единицы, чтобы увидеть цену.')
    expect(g.addReason).toBe(g.blocked)
  })

  it('жёсткие замечания: цена для справки, формулировка про черновые правила, «Добавить» закрыто', () => {
    const g = priceGate({ ...ok, hardCount: 2 })
    expect(g.blocked).toBeNull()
    expect(g.hardNote).toMatch(/^По черновым правилам стекла \(ждут технолога\) деталь не пройдёт: 2 замечания/)
    expect(g.hardNote).toMatch(/только для справки/)
    expect(g.hardNote).not.toMatch(/нельзя изготовить/)
    expect(g.addReason).toMatch(/не пройдёт/)
  })

  it('DXF без контура — цены нет, без «загрузите чертёж»', () => {
    expect(priceGate({ ...ok, hasFacts: false }).blocked).toMatch(/в чертеже не найден контур/)
    expect(priceGate({ ...ok, tab: 'size', hasDxf: false, hasFacts: false }).blocked).toMatch(/Загрузите чертёж/)
  })

  it('unitsPendingFor: мм в файле — не спрашиваем; дюймы, метры, «не указаны» — до подтверждения', () => {
    const geom = (u: string) => parseDxf(dxf([rectLw(0, 0, 100, 60)], u === 'none' ? { insunits: null } : { insunits: { mm: 4, inch: 1, m: 6 }[u] }))
    const d: Dxf = { text: '', name: 'a', units: null }
    expect(unitsPendingFor(d, geom('mm'))).toBe(false)
    expect(unitsPendingFor(d, geom('inch'))).toBe(true)
    expect(unitsPendingFor(d, geom('m'))).toBe(true)
    expect(unitsPendingFor(d, geom('none'))).toBe(true)
    expect(unitsPendingFor({ ...d, units: 'inch' }, geom('inch'))).toBe(false)
  })
})
