import { describe, it, expect } from 'vitest'
import { calcTypeLabel, calcDetail, calcCaption } from '@/lib/calcLabel'

// Снимки input_data — по форме реальных записей calculations (№131–140).
const quickMany = {
  cart: [
    { title: 'Перегородка на ванну распашная 680 глухая, 300 дверь, высота 1800 мм' },
    { title: 'Зеркало с фронтальной подсветкой Осветлённое 4 мм 700×2150 в спальню' },
    { title: 'Зеркало в прихожую 1830х2780мм тонированное графит' },
  ],
  title: '', glass: 'clear', hw: 'gold', margin: 40,
}
const buildOne = {
  code: 'М7',
  dims: { width: 1200, height: 2000, width2: 1000, doorWidth: 600 },
  cart: [{ title: 'М7 Угловая распашная · 1200×1000×2000 мм', total: 120000 }],
}

describe('имя типа расчёта', () => {
  it('quick и build — по-русски, не сырой product_type', () => {
    expect(calcTypeLabel('quick')).toBe('Быстрый расчёт')
    expect(calcTypeLabel('build')).toBe('Расчёт')
  })

  it('зеркало, лофт, душевые — как было на главной', () => {
    expect(calcTypeLabel('mirror')).toBe('Зеркало')
    expect(calcTypeLabel('loft')).toBe('Лофт')
    expect(calcTypeLabel('shower_budget')).toBe('Душевая')
  })

  it('неизвестный тип остаётся как есть, пустой — «Расчёт»', () => {
    expect(calcTypeLabel('glass_wall')).toBe('glass_wall')
    expect(calcTypeLabel(null)).toBe('Расчёт')
  })
})

describe('подпись расчёта', () => {
  it('зеркало и лофт — ширина×высота', () => {
    expect(calcDetail('mirror', { width: 700, height: 2150 })).toBe('700×2150 мм')
    expect(calcDetail('loft', { width: '3000', height: '2700', sections: 4 })).toBe('3000×2700 мм')
  })

  it('душевая — dimStr, без него ширина×высота', () => {
    expect(calcDetail('shower', { dimStr: '900×900×2000', width: 900, height: 2000 })).toBe('900×900×2000')
    expect(calcDetail('shower_standard', { width: 1000, height: 2000 })).toBe('1000×2000 мм')
  })

  it('нет размеров — пусто, а не undefined×undefined', () => {
    expect(calcDetail('mirror', {})).toBeNull()
    expect(calcDetail('mirror', { width: 700 })).toBeNull()
    expect(calcDetail('loft', { width: '', height: null })).toBeNull()
    expect(calcDetail('shower', { dimStr: '  ' })).toBeNull()
    expect(calcDetail('mirror', null)).toBeNull()
  })

  it('быстрый расчёт с одним изделием — его название', () => {
    const one = { cart: [{ title: 'Душевая М2 1040×2000' }], title: '' }
    expect(calcDetail('quick', one)).toBe('Душевая М2 1040×2000')
    expect(calcCaption('quick', one)).toBe('Быстрый расчёт Душевая М2 1040×2000')
  })

  it('быстрый расчёт с несколькими изделиями — их число, как в client_text', () => {
    expect(calcDetail('quick', quickMany)).toBe('3 изд.')
    expect(calcCaption('quick', quickMany)).toBe('Быстрый расчёт (3 изд.)')
  })

  it('быстрый расчёт с пустой корзиной — title формы или ничего', () => {
    expect(calcDetail('quick', { cart: [], title: 'Зеркало в ванную' })).toBe('Зеркало в ванную')
    expect(calcDetail('quick', { cart: [], title: '' })).toBeNull()
    expect(calcDetail('quick', {})).toBeNull()
    expect(calcCaption('quick', { cart: [] })).toBe('Быстрый расчёт')
  })

  it('изделие без названия берёт запасное, а не пустую строку', () => {
    expect(calcDetail('quick', { cart: [{ total: 5000 }], title: 'Перегородка' })).toBe('Перегородка')
    expect(calcDetail('quick', { cart: [null] })).toBeNull()
  })

  it('«Расчёт» — название из корзины', () => {
    expect(calcDetail('build', buildOne)).toBe('М7 Угловая распашная · 1200×1000×2000 мм')
    expect(calcCaption('build', buildOne)).toBe('Расчёт М7 Угловая распашная · 1200×1000×2000 мм')
  })

  it('«Расчёт» без корзины — модель и размеры из dims', () => {
    expect(calcDetail('build', { code: 'М7', dims: { width: 1200, height: 2000, width2: 1000 } })).toBe('М7 1200×1000×2000 мм')
    expect(calcDetail('build', { code: 'М1', dims: { width: 1000, height: 2000 }, cart: [] })).toBe('М1 1000×2000 мм')
    expect(calcDetail('build', { modelId: 'М2', width: 1040, height: 2000 })).toBe('М2 1040×2000 мм')
  })

  it('«Расчёт» без корзины и размеров — модель или ничего', () => {
    expect(calcDetail('build', { code: 'М1', dims: {} })).toBe('М1')
    expect(calcDetail('build', { dims: { width: 1000 } })).toBeNull()
  })

  it('ни одна подпись не содержит undefined', () => {
    const inputs = [null, {}, { cart: [] }, { cart: [{}] }, { dims: {} }, { width: 1 }]
    for (const t of ['mirror', 'loft', 'shower', 'quick', 'build', 'railing']) {
      for (const d of inputs) {
        expect(String(calcDetail(t, d))).not.toContain('undefined')
        expect(calcCaption(t, d)).not.toContain('undefined')
      }
    }
  })
})
