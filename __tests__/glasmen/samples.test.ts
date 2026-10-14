import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseDxf } from '@/lib/glasmen/dxf'
import { allIssues, glassRules } from '@/lib/glasmen/rules'
import { geometryToQuoteFacts } from '@/lib/glasmen/toQuoteInput'

const DIR = join(__dirname, '../../public/glasmen-demo/samples')
const read = (f: string) => parseDxf(readFileSync(join(DIR, f), 'utf8'), { name: f })

describe('образцы DXF для демо', () => {
  it('в папке 4 образца, каждый разбирается без жёстких замечаний', () => {
    const files = readdirSync(DIR).filter(f => f.endsWith('.dxf')).sort()
    expect(files).toEqual(['round-mirror-d600.dxf', 'shelf-600x250-holes.dxf', 'shower-door-800x2000-hinges.dxf', 'splashback-2000x600-sockets.dxf'])
    for (const f of files) {
      const g = read(f)
      expect(g.issues, f).toEqual([])
      expect(g.units.detected).toBe('mm')
    }
  })

  it('полка 600×250, 8 мм закалка: 2 отверстия Ø10, передние углы R30', () => {
    const g = read('shelf-600x250-holes.dxf')
    expect([g.width, g.height]).toEqual([600, 250])
    expect(g.cornerRadii).toEqual([0, 0, 30, 30])
    expect(geometryToQuoteFacts(g)).toMatchObject({ holes: [{ d: 10, n: 2 }], cutouts: 0, shape: 'curved' })
    expect(allIssues(g, glassRules(8, true))).toEqual([])
  })

  it('фартук 2000×600, 6 мм закалка: 2 выреза под розетки', () => {
    const g = read('splashback-2000x600-sockets.dxf')
    expect([g.width, g.height, g.shape]).toEqual([2000, 600, 'rect'])
    expect(g.cutouts.map(c => c.minInnerRadius)).toEqual([8, 8])
    expect(allIssues(g, glassRules(6, true))).toEqual([])
  })

  it('круглое зеркало Ø600, 4 мм без закалки', () => {
    const g = read('round-mirror-d600.dxf')
    expect(g.width).toBeCloseTo(600, 6)
    expect(g.areaNet).toBeCloseTo(Math.PI * 0.09, 6)
    expect(g.shape).toBe('curved')
    expect(allIssues(g, glassRules(4, true, { category: 'mirror' }))).toEqual([])
  })

  it('дверь душевой 800×2000, 8 мм закалка: 2 отверстия под петли', () => {
    const g = read('shower-door-800x2000-hinges.dxf')
    expect([g.width, g.height, g.shape]).toEqual([800, 2000, 'rect'])
    expect(g.holes).toEqual([{ cx: 30, cy: 250, d: 16 }, { cx: 30, cy: 1750, d: 16 }])
    expect(allIssues(g, glassRules(8, true))).toEqual([])
  })
})
