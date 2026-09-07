import { describe, it, expect } from 'vitest'
import { checkCalculation, phoneDigits } from '@/lib/calcInvariants'

const base = { final_price: 50000, base_price: 40000, margin: 40 }

describe('инварианты расчёта', () => {
  it('продающий расчёт без клиента не сохраняется', () => {
    const r = checkCalculation({ ...base, product_type: 'build' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('имя')
  })

  it('имя есть, телефона нет — тоже не сохраняется', () => {
    const r = checkCalculation({ ...base, product_type: 'build', client_name: 'Иван' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('телефон')
  })

  it('короткий телефон не проходит', () => {
    const r = checkCalculation({ ...base, product_type: 'build', client_name: 'Иван', client_phone: '+7 999' })
    expect(r.ok).toBe(false)
  })

  it('имя и телефон есть — проходит', () => {
    const r = checkCalculation({
      ...base, product_type: 'build', client_name: 'Иван', client_phone: '+7 (999) 123-45-67',
    })
    expect(r.ok).toBe(true)
  })

  it('расчёт внутри сделки клиента не требует — он известен из карточки', () => {
    const r = checkCalculation({ ...base, product_type: 'build', deal_id: 12 })
    expect(r.ok).toBe(true)
  })

  it('быстрый расчёт остаётся свободным — им считают на бегу', () => {
    const r = checkCalculation({ ...base, product_type: 'quick' })
    expect(r.ok).toBe(true)
  })

  it('зеркало и душевая клиента не требуют', () => {
    expect(checkCalculation({ ...base, product_type: 'mirror' }).ok).toBe(true)
    expect(checkCalculation({ ...base, product_type: 'shower' }).ok).toBe(true)
  })

  it('маржа выше 95% — признак ошибки в расчёте прибыли', () => {
    const r = checkCalculation({ ...base, product_type: 'quick', margin: 98 })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('Маржа')
  })

  it('отрицательная цена не сохраняется', () => {
    const r = checkCalculation({ ...base, product_type: 'quick', final_price: -1 })
    expect(r.ok).toBe(false)
  })

  it('NaN в цене не сохраняется', () => {
    const r = checkCalculation({ ...base, product_type: 'quick', final_price: NaN })
    expect(r.ok).toBe(false)
  })

  it('телефон считается по цифрам, а не по длине строки', () => {
    expect(phoneDigits('+7 (999) 123-45-67')).toBe('79991234567')
    expect(phoneDigits('—')).toBe('')
    expect(phoneDigits(undefined)).toBe('')
  })
})
