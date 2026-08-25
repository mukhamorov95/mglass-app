import { describe, it, expect } from 'vitest'
import { phoneKey, samePhone, formatPhone, extractPhone } from '@/lib/b2c/phoneKey'

// Реальные форматы из базы: договоры пишут «8(915)129-12-77» и «8967-400-93-48»,
// заявки с сайта — «+7 915 …», менеджеры руками — «89151291277».

describe('ключ сделки по телефону', () => {
  it('сводит разные форматы одного номера к одному ключу', () => {
    const variants = ['8(915)129-12-77', '+7 915 129-12-77', '89151291277', '+79151291277', '9151291277']
    const keys = new Set(variants.map(phoneKey))
    expect(keys.size).toBe(1)
    expect([...keys][0]).toBe('9151291277')
  })

  it('мусор и короткие номера ключом не становятся', () => {
    expect(phoneKey('')).toBeNull()
    expect(phoneKey(null)).toBeNull()
    expect(phoneKey('нет телефона')).toBeNull()
    expect(phoneKey('12345')).toBeNull()
  })

  it('samePhone сравнивает по существу, а не по строке', () => {
    expect(samePhone('8967-400-93-48', '+7 (967) 400-93-48')).toBe(true)
    expect(samePhone('89151291277', '89151291278')).toBe(false)
    expect(samePhone(null, null)).toBe(false)
  })

  it('formatPhone приводит к человеческому виду', () => {
    expect(formatPhone('89151291277')).toBe('+7 (915) 129-12-77')
    expect(formatPhone('не телефон')).toBe('не телефон')
  })

  it('extractPhone достаёт номер из JSON договора', () => {
    expect(extractPhone({ name: 'ООО Ромашка', phone: '8967-400-93-48' })).toBe('9674009348')
    expect(extractPhone({ client_phone: '+7 915 129 12 77' })).toBe('9151291277')
    expect(extractPhone({ name: 'без телефона' })).toBeNull()
  })
})
