import { describe, it, expect } from 'vitest'
import { computeRailing, slopeOf, STANDARD_STEP, type RailingSegment } from '@/lib/railingCalculator'

const OBJECT_SEGMENTS: RailingSegment[] = [
  { name: '1 этаж (первый пролёт)', spanMm: 2670, shape: 'raked' },
  { name: '1→2 этаж',              spanMm: 3020, shape: 'raked' },
  { name: '2→3 этаж (а)',          spanMm: 2925, shape: 'raked' },
  { name: '2→3 этаж (б)',          spanMm: 2935, shape: 'raked' },
  { name: '3→4 этаж (а)',          spanMm: 2940, shape: 'raked' },
  { name: '3→4 этаж (б, до стены)', spanMm: 2285, shape: 'raked' },
]

describe('slopeOf', () => {
  it('считает угол ската и коэффициент наклонной длины из ступени 297/180', () => {
    const s = slopeOf(STANDARD_STEP)
    expect(s.angleDeg).toBeCloseTo(31.2, 1)
    expect(s.factor).toBeCloseTo(1.169, 3)
  })
})

describe('computeRailing — параллелограмм', () => {
  it('нетто параллелограмма = ширина × высота (скос площадь не меняет)', () => {
    const r = computeRailing([{ name: 'x', spanMm: 1000, shape: 'raked' }], {
      heightMm: 1000, thicknessMm: 10, materialName: 'Прозрачное',
      fixing: 'points', maxPanelWidthMm: 1000, step: STANDARD_STEP,
    })
    // 1000×1000 мм = 1 м²
    expect(r.netM2).toBeCloseTo(1.0, 2)
    // заготовка выше на ширину·tgθ = 1000·0.606 = 606 → blank 1000×1606
    expect(r.blankM2).toBeCloseTo(1.61, 2)
  })

  it('прямое ограждение не имеет обреза ската (нетто = заготовка)', () => {
    const r = computeRailing([{ name: 't', spanMm: 2000, shape: 'rectangular' }], {
      heightMm: 1000, thicknessMm: 8, materialName: 'Прозрачное',
      fixing: 'profile', maxPanelWidthMm: 1000, step: STANDARD_STEP,
    })
    expect(r.rakedWasteM2).toBeCloseTo(0, 2)
  })
})

describe('computeRailing — объект (6 пролётов)', () => {
  const res = computeRailing(OBJECT_SEGMENTS, {
    heightMm: 1100, thicknessMm: 10, materialName: 'Прозрачное закалённое',
    fixing: 'points', maxPanelWidthMm: 1200, step: STANDARD_STEP, costPerM2: 4500,
  })

  it('печатает разбивку по объекту', () => {
    const line = (a: string, b: unknown) => `${a.padEnd(30)} ${b}`
    console.log(`\nСкат: ${res.slope.angleDeg}°, коэф. наклонной длины ${res.slope.factor.toFixed(3)}\n`)
    console.log('Пролёт'.padEnd(26), 'ступ', 'пол', 'шир', 'нетто', 'загот', 'обрез_ската')
    for (const s of res.segments) {
      console.log(
        s.name.padEnd(26), String(s.steps).padStart(4), String(s.panelCount).padStart(3),
        String(Math.round(s.panelWidthMm)).padStart(4), s.netM2.toFixed(2).padStart(5),
        s.blankM2.toFixed(2).padStart(5), s.rakedWasteM2.toFixed(2).padStart(11))
    }
    console.log('\n── ИТОГО ──')
    console.log(line('Погонаж пролётов (гориз.), м:', res.spanTotalM))
    console.log(line('Длина стекла по скату, м:', res.alongSlopeTotalM))
    console.log(line('Чистое стекло (нетто), м²:', res.netM2))
    console.log(line('Заготовки (прямоуг.), м²:', res.blankM2))
    console.log(line('Обрез ската (треуг.), м²:', res.rakedWasteM2))
    console.log(line(`Лист ${res.sheet.width}×${res.sheet.height}, листов:`, res.sheetsNeeded))
    console.log(line('Площадь листов, м²:', res.totals.sheetM2))
    console.log(line('Потеря реза, м²:', res.totals.cutLossM2))
    console.log(line('Возвратный остаток, м²:', res.totals.remnantM2))
    console.log(line('Себестоимость (честно), ₽:', res.usage.reduce((a, u) => a + u.honestCost, 0)))
    console.log('\n── НА 1 ПОГ. МЕТР (горизонт.) ──')
    console.log(line('Ступеней:', res.perMeter.stepsPerM))
    console.log(line('Чистого стекла, м²/пог.м:', res.perMeter.netM2PerM))
    console.log(line('Заготовок, м²/пог.м:', res.perMeter.blankM2PerM))
    console.log(line('Стекла по скату, м/пог.м:', res.perMeter.alongSlopePerM))

    expect(res.segments).toHaveLength(6)
    expect(res.sheetsNeeded).toBeGreaterThan(0)
    // Сумма проступей ≈ пролёту: 2670/297 ≈ 9 ступеней
    expect(res.segments[0].steps).toBe(9)
    // нетто на пог.м при H=1100 ≈ 1.1 м²
    expect(res.perMeter.netM2PerM).toBeCloseTo(1.1, 1)
  })
})
