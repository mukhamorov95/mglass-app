import { describe, it, expect } from 'vitest'
import {
  groupIntoBatches, measureStationTime, measureWorkerThroughput, whyNoData,
  MIN_MEASUREMENTS, type Closure,
} from '@/lib/production/cycleTime'

const T0 = Date.parse('2026-08-26T08:00:00Z')
const min = (m: number) => T0 + m * 60000
const c = (worker: string, station: string, atMin: number): Closure =>
  ({ worker, workerName: worker, station, at: min(atMin) })

describe('groupIntoBatches — отметки пачкой это одно нажатие, а не три работы', () => {
  it('три отметки в одну секунду — одна пачка из трёх изделий', () => {
    const b = groupIntoBatches([c('n', 'cutting', 0), c('n', 'cutting', 0), c('n', 'cutting', 0)])
    expect(b).toHaveLength(1)
    expect(b[0].items).toBe(3)
  })

  it('разрыв больше минуты разрывает пачку', () => {
    const b = groupIntoBatches([c('n', 'cutting', 0), c('n', 'cutting', 5)])
    expect(b).toHaveLength(2)
  })

  it('разные станции одного человека — разные пачки', () => {
    const b = groupIntoBatches([c('n', 'cutting', 0), c('n', 'polishing', 0)])
    expect(b).toHaveLength(2)
  })

  it('разные люди не смешиваются', () => {
    const b = groupIntoBatches([c('n', 'cutting', 0), c('b', 'cutting', 0)])
    expect(b).toHaveLength(2)
  })
})

describe('measureStationTime', () => {
  it('час на пачку из четырёх изделий — 15 минут на изделие', () => {
    const s = measureStationTime([c('b', 'cutting', 0), ...[60, 60, 60, 60].map(m => c('b', 'cutting', m))])
    expect(s[0].station).toBe('cutting')
    expect(s[0].measurements).toBe(1)
    expect(s[0].items).toBe(4)
    expect(s[0].medianMin).toBeCloseTo(15)
  })

  it('ЗАГРЯЗНЁННЫЙ ИНТЕРВАЛ ВЫБРАСЫВАЕТСЯ: между отметками человек работал на другой станции', () => {
    const s = measureStationTime([
      c('n', 'polishing', 0),
      c('n', 'packaging', 30),   // в середине окна — чужая станция
      c('n', 'polishing', 60),
    ])
    const pol = s.find(x => x.station === 'polishing')!
    expect(pol.measurements).toBe(0)
    expect(pol.droppedDirty).toBe(1)
    expect(pol.medianMin).toBeNull()
  })

  it('интервал через ночь выбрасывается как перерыв, а не занижает выработку', () => {
    const s = measureStationTime([c('b', 'cutting', 0), c('b', 'cutting', 16 * 60)])
    expect(s[0].measurements).toBe(0)
    expect(s[0].droppedLong).toBe(1)
  })

  it('первая отметка станции меры не даёт — сравнивать не с чем', () => {
    expect(measureStationTime([c('b', 'cutting', 0)])[0].measurements).toBe(0)
  })

  it('одностаночник измеряется, многостаночник на той же выборке — нет', () => {
    // Бекмурза только режет; Никита в тот же час крутится между полировкой и упаковкой
    const s = measureStationTime([
      c('b', 'cutting', 0), c('b', 'cutting', 20), c('b', 'cutting', 40),
      c('n', 'polishing', 0), c('n', 'packaging', 10), c('n', 'polishing', 20), c('n', 'packaging', 30),
    ])
    expect(s.find(x => x.station === 'cutting')!.measurements).toBe(2)
    expect(s.find(x => x.station === 'polishing')!.measurements).toBe(0)
    expect(s.find(x => x.station === 'packaging')!.measurements).toBe(0)
  })
})

describe('measureWorkerThroughput — для многостаночника единственная честная мера', () => {
  it('станции не различает, поэтому загрязнения нет по определению', () => {
    const w = measureWorkerThroughput([
      c('n', 'polishing', 0), c('n', 'packaging', 10), c('n', 'polishing', 20), c('n', 'packaging', 30),
    ])
    expect(w[0].measurements).toBe(3)
    expect(w[0].medianMin).toBeCloseTo(10)
  })

  it('пачка делит интервал на изделия', () => {
    const w = measureWorkerThroughput([c('n', 'cutting', 0), c('n', 'cutting', 60), c('n', 'polishing', 60)])
    expect(w[0].medianMin).toBeCloseTo(30)   // 60 минут на два изделия
  })
})

describe('whyNoData — пустая клетка объясняет себя', () => {
  const base = { station: 'polishing', measurements: 0, items: 0, medianMin: null, p90Min: null, droppedDirty: 0, droppedLong: 0 }

  it('загрязнение названо причиной, а не «нет данных»', () => {
    expect(whyNoData({ ...base, droppedDirty: 5 })).toContain('других станциях')
  })

  it('только перерывы', () => {
    expect(whyNoData({ ...base, droppedLong: 3 })).toContain('перерывы')
  })

  it('когда замеров достаточно — объяснять нечего', () => {
    expect(whyNoData({ ...base, measurements: MIN_MEASUREMENTS, medianMin: 12 })).toBeNull()
  })

  it('три замера — это совпадение, а не выборка: число не показываем', () => {
    // на боевых данных упаковка дала ровно такой случай: 3 замера, медиана 0.3 минуты
    expect(whyNoData({ ...base, measurements: 3, medianMin: 0.3 })).toContain('мало замеров')
  })
})
