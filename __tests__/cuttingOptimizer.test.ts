import { describe, it, expect } from 'vitest'
import {
  runCuttingOptimizer, runCuttingOptimizerOptimized, DEFAULT_CUTTING_SETTINGS,
  type PieceGroup, type CuttingPiece, type MaterialCuttingResult,
} from '../lib/cuttingOptimizer'

function piece(id: string, w: number, h: number): CuttingPiece {
  return { id, width: w, height: h, label: `${w}x${h}`, orderId: 0, orderClientName: '', materialKey: 'k', canRotate: true }
}
function oneGroup(over: Partial<PieceGroup>): Map<string, PieceGroup> {
  const g: PieceGroup = {
    pieces: [], materialLabel: 'M', category: 'стекло',
    sheetWidth: 3210, sheetHeight: 2250, patternDirection: 'none', ...over,
  }
  return new Map([['k', g]])
}

describe('cuttingOptimizer — выбор формата листа', () => {
  it('выбирает формат, в который детали влезают (меньше нераскроенных)', () => {
    // Деталь 2200×1500 не влезает в 2000×2000, но влезает в 3210×2250.
    const pieces = [piece('a', 2200, 1500), piece('b', 2200, 1500)]
    const r = runCuttingOptimizer(
      oneGroup({ pieces, sheetFormats: [{ width: 2000, height: 2000 }, { width: 3210, height: 2250 }] }),
      DEFAULT_CUTTING_SETTINGS,
    )
    expect(r[0].unplacedCount).toBe(0)
    expect(r[0].sheetWidth).toBe(3210)
    expect(r[0].sheetHeight).toBe(2250)
  })

  it('при равном числе листов берёт меньший по площади (меньше закупки/отхода)', () => {
    const pieces = [piece('a', 500, 500)]
    const r = runCuttingOptimizer(
      oneGroup({ pieces, sheetFormats: [{ width: 3210, height: 2250 }, { width: 1000, height: 1000 }] }),
      DEFAULT_CUTTING_SETTINGS,
    )
    expect(r[0].sheetsNeeded).toBe(1)
    expect(r[0].sheetWidth).toBe(1000)
    expect(r[0].sheetHeight).toBe(1000)
  })

  it('без заданных форматов кроит на дефолтный размер группы', () => {
    const r = runCuttingOptimizer(oneGroup({ pieces: [piece('a', 500, 500)] }), DEFAULT_CUTTING_SETTINGS)
    expect(r[0].sheetWidth).toBe(3210)
    expect(r[0].sheetHeight).toBe(2250)
  })

  it('дедуп одинаковых форматов не ломает выбор', () => {
    const r = runCuttingOptimizer(
      oneGroup({ pieces: [piece('a', 500, 500)], sheetFormats: [{ width: 2000, height: 2000 }, { width: 2000, height: 2000 }] }),
      DEFAULT_CUTTING_SETTINGS,
    )
    expect(r[0].sheetsNeeded).toBe(1)
    expect(r[0].sheetWidth).toBe(2000)
  })

  it('игнорирует некорректные форматы и падает на дефолт', () => {
    const r = runCuttingOptimizer(
      oneGroup({ pieces: [piece('a', 500, 500)], sheetFormats: [{ width: 0, height: 0 }] }),
      DEFAULT_CUTTING_SETTINGS,
    )
    expect(r[0].sheetWidth).toBe(3210)
  })
})

describe('cuttingOptimizer — направление рисунка (фактурное стекло)', () => {
  // Лист 2100×1100 (ландшафт), деталь 900×2000 (портрет): влезает ТОЛЬКО повёрнутой.
  const sheet = { sheetWidth: 2100, sheetHeight: 1100 }
  const portrait = () => [piece('a', 900, 2000)]

  it('обычное стекло: поворот разрешён — деталь раскроена', () => {
    const r = runCuttingOptimizer(oneGroup({ ...sheet, pieces: portrait(), patternDirection: 'none' }), DEFAULT_CUTTING_SETTINGS)
    expect(r[0].unplacedCount).toBe(0)
  })

  // Правило владельца 15.09: МОРУ и Эстриадо режутся только вдоль длины листа, полоса на
  // изделии — по высоте детали. Раньше тест ждал «не влезает»: раскрой клал высоту детали
  // поперёк длины листа, и на 7 из 12 заказов с МОРУ детали терялись.
  it('фактурное (вдоль длины): высота детали идёт вдоль длины листа — деталь раскроена', () => {
    const r = runCuttingOptimizer(oneGroup({ ...sheet, pieces: portrait(), patternDirection: 'along_length' }), DEFAULT_CUTTING_SETTINGS)
    expect(r[0].unplacedCount).toBe(0)
    const placed = r[0].sheets[0].pieces[0]
    expect(placed).toMatchObject({ w: 2000, h: 900, rotated: true })
  })

  it('фактурное (вдоль длины): широкую деталь развернуть нельзя — полоса ушла бы поперёк', () => {
    // 2000×900: высота 900 должна лечь вдоль длины 2100, тогда ширина 2000 — поперёк 1100. Не влезает.
    const r = runCuttingOptimizer(oneGroup({ ...sheet, pieces: [piece('b', 2000, 900)], patternDirection: 'along_length' }), DEFAULT_CUTTING_SETTINGS)
    expect(r[0].unplacedCount).toBe(1)
    expect(r[0].unplacedPieces[0]).toMatchObject({ width: 2000, height: 900 })
  })

  it('фактурное (вдоль ширины): высота детали — поперёк длины, портрет не влезает', () => {
    const r = runCuttingOptimizer(oneGroup({ ...sheet, pieces: portrait(), patternDirection: 'along_width' }), DEFAULT_CUTTING_SETTINGS)
    expect(r[0].unplacedCount).toBe(1)
  })

  it('лист 3210×2250, МОРУ: дверь 700×2300 раскроена вдоль длины', () => {
    const r = runCuttingOptimizer(oneGroup({ pieces: [piece('d', 700, 2300), piece('e', 700, 2300)], patternDirection: 'along_length' }), DEFAULT_CUTTING_SETTINGS)
    expect(r[0].unplacedCount).toBe(0)
    expect(r[0].sheetsNeeded).toBe(1)
    expect(r[0].sheets[0].pieces.every(pl => pl.w === 2300 && pl.h === 700)).toBe(true)
  })

  it('respect_pattern=false: поворот разрешён даже для фактурного', () => {
    const r = runCuttingOptimizer(
      oneGroup({ ...sheet, pieces: portrait(), patternDirection: 'along_length' }),
      { ...DEFAULT_CUTTING_SETTINGS, respect_pattern: false },
    )
    expect(r[0].unplacedCount).toBe(0)
  })
})

// Независимая проверка раскладки: деталь в границах [E, W−E]×[E, H−E], любые две разведены
// зазором G хотя бы по одной оси, каждая деталь ровно один раз (на листе или в нераскроенных),
// и лист режется гильотиной — набор деталей всегда делится сквозным резом.
type Rect = { x: number; y: number; w: number; h: number }
function guillotine(ps: Rect[]): boolean {
  if (ps.length <= 1) return true
  for (const a of ps) {
    const c = a.x + a.w
    const left = ps.filter(p => p.x + p.w <= c), right = ps.filter(p => p.x >= c)
    if (left.length && right.length && left.length + right.length === ps.length) return guillotine(left) && guillotine(right)
    const d = a.y + a.h
    const top = ps.filter(p => p.y + p.h <= d), bottom = ps.filter(p => p.y >= d)
    if (top.length && bottom.length && top.length + bottom.length === ps.length) return guillotine(top) && guillotine(bottom)
  }
  return false
}
function layoutErrors(r: MaterialCuttingResult, E = DEFAULT_CUTTING_SETTINGS.edge_margin, G = DEFAULT_CUTTING_SETTINGS.gap_between_pieces): string[] {
  const errs: string[] = []
  const seen = new Set<string>()
  for (const sh of r.sheets) {
    for (const p of sh.pieces) {
      if (seen.has(p.id)) errs.push(`дважды ${p.id}`)
      seen.add(p.id)
      if (p.x < E || p.y < E || p.x + p.w > r.sheetWidth - E || p.y + p.h > r.sheetHeight - E) errs.push(`за краем: лист ${sh.index}, ${p.id}`)
    }
    sh.pieces.forEach((a, i) => sh.pieces.slice(i + 1).forEach(b => {
      const apart = a.x + a.w + G <= b.x || b.x + b.w + G <= a.x || a.y + a.h + G <= b.y || b.y + b.h + G <= a.y
      if (!apart) errs.push(`перекрытие: лист ${sh.index}, ${a.id} и ${b.id}`)
    }))
    if (!guillotine(sh.pieces)) errs.push(`не гильотина: лист ${sh.index}`)
  }
  for (const u of r.unplacedPieces) {
    if (seen.has(u.id)) errs.push(`и на листе, и в нераскроенных: ${u.id}`)
    seen.add(u.id)
  }
  if (seen.size !== r.totalPieces) errs.push(`деталей ${seen.size} из ${r.totalPieces}`)
  return errs
}

const series = (n: number, w: number, h: number, tag = '') =>
  Array.from({ length: n }, (_, i) => ({ ...piece(`${tag}${w}x${h}-${i}`, w, h), orderId: i % 3 }))

const optimizers = [
  ['runCuttingOptimizer', (g: Map<string, PieceGroup>) => runCuttingOptimizer(g, DEFAULT_CUTTING_SETTINGS)],
  ['runCuttingOptimizerOptimized', (g: Map<string, PieceGroup>) => runCuttingOptimizerOptimized(g, DEFAULT_CUTTING_SETTINGS, 300)],
] as const

describe('cuttingOptimizer — блочная раскладка одинаковых деталей (лист 3210×2250, зазор 2, отступ 2)', () => {
  // Найдено 01.10.2026: BSSF и полосы клали 20 шт 291×913 и 28 шт 291×656 на лист,
  // блочная раскладка с добором полосы — 23 и 31.
  describe.each(optimizers)('%s', (_name, run) => {
    it('100 шт 291×913: на первом листе ≥ 23 (10 стоя × 2 ряда + 3 лёжа в нижней полосе)', () => {
      const r = run(oneGroup({ pieces: series(100, 291, 913) }))[0]
      expect(r.sheets[0].pieces.length).toBeGreaterThanOrEqual(23)
      expect(r.unplacedCount).toBe(0)
      expect(layoutErrors(r)).toEqual([])
    })

    it('100 шт 291×656: на первом листе ≥ 31 (сетка лёжа + стоя в правой полосе)', () => {
      const r = run(oneGroup({ pieces: series(100, 291, 656) }))[0]
      expect(r.sheets[0].pieces.length).toBeGreaterThanOrEqual(31)
      expect(r.unplacedCount).toBe(0)
      expect(layoutErrors(r)).toEqual([])
    })

    it('92 шт 291×913 — четыре листа, а не пять', () => {
      const r = run(oneGroup({ pieces: series(92, 291, 913) }))[0]
      expect(r.sheetsNeeded).toBe(4)
      expect(layoutErrors(r)).toEqual([])
    })

    it('22 шт 291×913 — один неполный лист по той же раскладке, а не 20 + 2', () => {
      const r = run(oneGroup({ pieces: series(22, 291, 913) }))[0]
      expect(r.sheetsNeeded).toBe(1)
      expect(layoutErrors(r)).toEqual([])
    })

    it('два типоразмера серией: листов не больше, чем у каждого отдельно, раскладка корректна', () => {
      const a = series(50, 291, 913, 'a'), b = series(50, 291, 656, 'b')
      const both = run(oneGroup({ pieces: [...a, ...b] }))[0]
      const alone = run(oneGroup({ pieces: a }))[0].sheetsNeeded + run(oneGroup({ pieces: b }))[0].sheetsNeeded
      expect(both.sheetsNeeded).toBeLessThanOrEqual(alone)
      expect(both.unplacedCount).toBe(0)
      expect(layoutErrors(both)).toEqual([])
    })

    it('смесь с крупными, мелкими и непомещающейся деталью — всё в границах, без перекрытий', () => {
      const pieces = [
        ...series(17, 600, 1800, 'a'), ...series(9, 450, 450, 'b'), ...series(3, 100, 150, 'c'),
        piece('d', 2000, 1500), piece('e', 3300, 400),
      ]
      const r = run(oneGroup({ pieces }))[0]
      expect(r.unplacedPieces.map(p => p.id)).toEqual(['e'])
      expect(layoutErrors(r)).toEqual([])
    })

    it('фактурное (вдоль длины): блочная раскладка не разворачивает детали поперёк рисунка', () => {
      const r = run(oneGroup({ pieces: series(12, 700, 2300), patternDirection: 'along_length' }))[0]
      expect(r.unplacedCount).toBe(0)
      expect(r.sheets.flatMap(s => s.pieces).every(pl => pl.w === 2300 && pl.h === 700)).toBe(true)
      expect(layoutErrors(r)).toEqual([])
    })
  })

  it('деталь шире листа — в нераскроенных, а не за краем листа (полосовой раскрой клал её как есть)', () => {
    const r = runCuttingOptimizer(oneGroup({ pieces: [piece('wide', 3300, 500), piece('ok', 1000, 1000)] }), DEFAULT_CUTTING_SETTINGS)[0]
    expect(r.unplacedPieces.map(p => p.id)).toEqual(['wide'])
    expect(layoutErrors(r)).toEqual([])
  })
})
