import { describe, it, expect } from 'vitest'
import { retailLine, retailQuote, normalizeMarkup, normalizeSettingsInput, parseDraft, describeSpec, DEFAULT_MARKUP_PCT } from '@/lib/partner/counter'

describe('розница точки — закупка партнёра × (1 + наценка)', () => {
  it('25% от 1000 ₽ — ровно 1250 ₽, без «плавающих» 10 ₽ сверху', () => expect(retailLine(1000, 25)).toBe(1250))
  it('вверх до 10 ₽: точка не теряет на копейках', () => {
    expect(retailLine(1001, 25)).toBe(1260)
    expect(retailLine(2347, 25)).toBe(2940)
  })
  it('наценка 0 — цена закупки, округлённая до 10 ₽', () => expect(retailLine(1234, 0)).toBe(1240))
  it('пустая или отрицательная строка — 0', () => {
    expect(retailLine(0, 25)).toBe(0)
    expect(retailLine(-5, 25)).toBe(0)
  })
  it('итог КП — сумма напечатанных строк', () => {
    const q = retailQuote([1001, 2347, 999], 25)
    expect(q.lines).toEqual([1260, 2940, 1250])
    expect(q.total).toBe(q.lines.reduce((s, l) => s + l, 0))
  })
  it('по умолчанию наценка 25%', () => expect(DEFAULT_MARKUP_PCT).toBe(25))
})

describe('наценка и настройки КП', () => {
  it('принимает запятую и строку', () => expect(normalizeMarkup('27,5')).toBe(27.5))
  it('вне 0…300 и пустое — нет', () => {
    for (const v of [-1, 301, '', null, 'abc', NaN]) expect(normalizeMarkup(v)).toBeNull()
  })
  it('настройки режутся по длине и чистятся от пробелов', () => {
    const r = normalizeSettingsInput({ markupPct: 30, kpName: '  ИП Петров  ', kpPhone: 'x'.repeat(60), kpNote: 7 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.kpName).toBe('ИП Петров')
      expect(r.value.kpPhone).toHaveLength(40)
      expect(r.value.kpNote).toBe('')
    }
  })
  it('без наценки не сохраняем и объясняем', () => {
    const r = normalizeSettingsInput({ kpName: 'А' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('Наценка')
  })
})

describe('черновик прилавка', () => {
  const good = { materialId: 7, width: 600, height: 800, quantity: 2, hasTempering: true, hasFacet: true, facetTypeMm: 10, shape: 'rect' }
  it('битый JSON и не массив — пусто', () => {
    expect(parseDraft('{')).toEqual([])
    expect(parseDraft('{"a":1}')).toEqual([])
    expect(parseDraft(null)).toEqual([])
  })
  it('позиции без размера или материала отбрасываются', () => {
    const list = parseDraft(JSON.stringify([good, { ...good, width: 0 }, { ...good, materialId: 'x' }, 5]))
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ materialId: 7, width: 600, height: 800, quantity: 2, hasTempering: true, facetTypeMm: 10, applyMinPrice: true })
  })
  it('мин. цена включена, пока явно не выключена', () => {
    expect(parseDraft(JSON.stringify([{ ...good, applyMinPrice: false }]))[0].applyMinPrice).toBe(false)
  })
  it('не больше 50 позиций', () => expect(parseDraft(JSON.stringify(Array(80).fill(good)))).toHaveLength(50))
  it('описание обработки', () => expect(describeSpec(parseDraft(JSON.stringify([good]))[0])).toBe('закалка, фацет 10 мм'))
})
