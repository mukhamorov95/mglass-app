import { describe, it, expect } from 'vitest'
import { kpImportWarnings, kpReconcileNotes, matchProductionDays } from '@/lib/kp/importCheck'

// toLocaleString('ru-RU') разделяет тысячи неразрывным пробелом — сравниваем
// по обычному, иначе тест падает на строке, которая выглядит правильной.
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')
const warn = (kp: Parameters<typeof kpImportWarnings>[0]) => kpImportWarnings(kp).map(norm)

const good = {
  title: 'ДУШЕВАЯ КАБИНА',
  items: [
    { name: 'Душевая перегородка', qty: 1, price: 120000, sum: 120000 },
    { name: 'Монтаж', qty: 1, price: 13000, sum: 13000 },
  ],
  total: 133000,
}

describe('kpImportWarnings', () => {
  it('ровное КП проходит без замечаний', () => {
    expect(kpImportWarnings(good)).toEqual([])
  })

  it('строки не сходятся с итогом — говорим обе суммы и разницу', () => {
    const w = warn({ ...good, total: 140000 })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('133 000 ₽')
    expect(w[0]).toContain('140 000 ₽')
    expect(w[0]).toContain('7 000 ₽')
    expect(w[0]).toContain('в файле больше')
  })

  it('расхождение в рубль тоже видно, копейки — нет', () => {
    expect(kpImportWarnings({ ...good, total: 133001 })).toHaveLength(1)
    expect(kpImportWarnings({ ...good, total: 133000.4 })).toEqual([])
  })

  it('строка без суммы названа поимённо', () => {
    const w = warn({ ...good, items: [...good.items, { name: 'Доставка', qty: 1 }] })
    expect(w.some(x => x.includes('Доставка'))).toBe(true)
  })

  it('итог не прочитался — показываем сумму строк', () => {
    const w = warn({ ...good, total: undefined })
    expect(w[0]).toContain('133 000 ₽')
  })

  it('нет позиций — остальное не проверяем, просим добавить строки', () => {
    expect(kpImportWarnings({ items: [], total: 100 })).toEqual([
      'В файле не нашлись позиции сметы — добавьте строки вручную.',
    ])
  })

  it('пустой заголовок — отдельное замечание', () => {
    const w = warn({ ...good, title: '  ' })
    expect(w).toEqual(['Заголовок не прочитался — впишите тип изделия.'])
  })
})

describe('kpReconcileNotes', () => {
  it('подставленную сумму строки называем и показываем', () => {
    const raw = { items: [{ name: 'Изделие', sum: 120000 }, { name: 'Доставка' }], total: 125750 }
    const fixed = { items: [{ name: 'Изделие', sum: 120000 }, { name: 'Доставка', sum: 5750 }], total: 125750 }
    const n = kpReconcileNotes(raw, fixed).map(norm)
    expect(n).toHaveLength(1)
    expect(n[0]).toContain('«Доставка»')
    expect(n[0]).toContain('5 750 ₽')
  })

  it('подставленный итог называем суммой строк', () => {
    const raw = { items: [{ name: 'Изделие', sum: 120000 }] }
    const fixed = { items: [{ name: 'Изделие', sum: 120000 }], total: 120000 }
    expect(kpReconcileNotes(raw, fixed).map(norm)[0]).toContain('поставили сумму строк, 120 000 ₽')
  })

  it('ничего не подставляли — молчим', () => {
    const kp = { items: [{ name: 'Изделие', sum: 100 }], total: 100 }
    expect(kpReconcileNotes(kp, kp)).toEqual([])
  })
})

describe('matchProductionDays', () => {
  it('число из свободного текста ложится в наш список', () => {
    expect(matchProductionDays('20 рабочих дней')).toBe('20 раб. дней')
    expect(matchProductionDays('срок — 10 р.д.')).toBe('10 раб. дней')
    expect(matchProductionDays(12)).toBe('12 раб. дней')
  })
  it('чего нет в списке — не выдумываем', () => {
    expect(matchProductionDays('18 дней')).toBeNull()
    expect(matchProductionDays('по согласованию')).toBeNull()
    expect(matchProductionDays(undefined)).toBeNull()
  })
  it('срок не из списка — замечание с обоими вариантами', () => {
    const w = warn({ ...good, production_days: '18 рабочих дней' })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('«18 рабочих дней»')
    expect(w[0]).toContain('10/12/15/20/25')
  })
  it('срок из списка замечаний не вызывает', () => {
    expect(kpImportWarnings({ ...good, production_days: '20 раб. дней' })).toEqual([])
  })
})
