import { describe, it, expect } from 'vitest'
import { unitMismatch, unitOfAccount } from '@/lib/bank/accountUnit'

describe('чья выписка — по номеру счёта', () => {
  it('40802 — ИП, 40702 — ООО, прочее — неизвестно', () => {
    expect(unitOfAccount('40802810000000000001')).toBe('ip')
    expect(unitOfAccount('40702810000000000001')).toBe('ooo')
    expect(unitOfAccount('30233810642000600001')).toBeNull()
    expect(unitOfAccount(null)).toBeNull()
  })
  it('выписка ООО под переключателем ИП — отказ с подсказкой; совпало или неизвестно — без отказа', () => {
    expect(unitMismatch(['40702810000000000001'], 'ip')).toMatch(/счёта ООО .*выбрано ИП.*Переключите на ООО/)
    expect(unitMismatch(['40802810000000000001'], 'ooo')).toMatch(/счёта ИП/)
    expect(unitMismatch(['40702810000000000001'], 'ooo')).toBeNull()
    expect(unitMismatch(['30233810642000600001'], 'ip')).toBeNull()
    expect(unitMismatch([], 'ip')).toBeNull()
  })
})
