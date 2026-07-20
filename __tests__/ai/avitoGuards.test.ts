import { describe, it, expect } from 'vitest'
import { extractPhone, mergeClientBurst, guardPrices, shouldHandOver } from '@/lib/ai-tools/avitoGuards'

describe('extractPhone', () => {
  it('берёт телефон в любом формате записи', () => {
    expect(extractPhone('мой номер +7 (916) 123-45-67')).toBe('+79161234567')
    expect(extractPhone('8 916 123 45 67 звоните')).toBe('+79161234567')
    expect(extractPhone('89161234567')).toBe('+79161234567')
    expect(extractPhone('телефон 916-123-45-67')).toBe('+79161234567')
  })
  it('не принимает размеры и суммы за телефон', () => {
    expect(extractPhone('размеры 800 на 2000')).toBeNull()
    expect(extractPhone('бюджет 45 000 рублей')).toBeNull()
    expect(extractPhone('0001112233')).toBeNull()
    expect(extractPhone('1111111111')).toBeNull()
  })
})

describe('mergeClientBurst', () => {
  it('склеивает подряд идущие реплики клиента', () => {
    const r = mergeClientBurst([
      { from: 'client', text: 'привет' },
      { from: 'client', text: 'нужна душевая' },
      { from: 'client', text: '800 на 2000' },
    ])
    expect(r).toHaveLength(1)
    expect(r[0].text).toBe('привет\nнужна душевая\n800 на 2000')
  })
  it('не склеивает реплики через ответ менеджера', () => {
    const r = mergeClientBurst([
      { from: 'client', text: 'привет' },
      { from: 'manager', text: 'здравствуйте' },
      { from: 'client', text: 'сколько стоит' },
    ])
    expect(r).toHaveLength(3)
  })
  it('не портит пустую историю', () => {
    expect(mergeClientBurst([])).toEqual([])
  })
})

describe('guardPrices — клиент не получит выдуманную цену', () => {
  it('пропускает цену, посчитанную калькулятором', () => {
    const r = guardPrices('Душевая обойдётся 45 300 ₽ с монтажом', [45300])
    expect(r.replaced).toBe(0)
    expect(r.text).toContain('45 300')
  })
  it('вырезает цену, которой калькулятор не считал', () => {
    const r = guardPrices('Ориентировочно 38 000 руб', [45300])
    expect(r.replaced).toBe(1)
    expect(r.text).not.toContain('38 000')
    expect(r.text).toContain('уточню точную сумму')
  })
  it('вырезает и число без валюты, если оно выглядит как цена', () => {
    const r = guardPrices('Такая душевая стоит 120 000, срок неделя', [])
    expect(r.replaced).toBe(1)
  })
  it('не трогает размеры в миллиметрах', () => {
    const r = guardPrices('Размер 800 на 2000 мм подойдёт', [])
    expect(r.replaced).toBe(0)
    expect(r.text).toContain('800')
  })
  it('не трогает мелкие суммы (доставка, подъём)', () => {
    const r = guardPrices('Доставка 2 000 ₽, подъём 1 500 ₽', [])
    expect(r.replaced).toBe(0)
  })
  it('допускает округление калькулятора на рубль', () => {
    expect(guardPrices('Итого 45 301 ₽', [45300.6]).replaced).toBe(0)
  })
  it('несколько цен: верную оставляет, лишнюю убирает', () => {
    const r = guardPrices('Зеркало 21 000 ₽, душевая 60 000 ₽', [21000])
    expect(r.replaced).toBe(1)
    expect(r.text).toContain('21 000')
    expect(r.text).not.toContain('60 000')
  })
})

describe('shouldHandOver', () => {
  it('после 12 ответов бота диалог уходит человеку', () => {
    const h = Array.from({ length: 12 }, () => ({ from: 'manager' as const, text: 'ответ' }))
    expect(shouldHandOver(h)).toBe(true)
  })
  it('короткий диалог бот ведёт сам', () => {
    expect(shouldHandOver([{ from: 'manager', text: 'здравствуйте' }])).toBe(false)
  })
})
