import { describe, it, expect } from 'vitest'
import { formatLabelCode, parseLabelCode } from '@/lib/production/labelCode'

describe('formatLabelCode', () => {
  it('маршрутный лист заказа', () => expect(formatLabelCode(101)).toBe('MG-101'))
  it('позиция целиком, когда лист один', () => expect(formatLabelCode(101, 0)).toBe('MG-101-0'))
  it('номер листа — когда их несколько', () => expect(formatLabelCode(101, 0, 3)).toBe('MG-101-0-3'))
  it('нулевая позиция не путается с отсутствием позиции', () => {
    expect(formatLabelCode(101, 0)).toBe('MG-101-0')
    expect(formatLabelCode(101, null)).toBe('MG-101')
  })
})

describe('parseLabelCode — старые наклейки должны читаться', () => {
  it('исторический формат без номера листа', () => {
    expect(parseLabelCode('MG-101-0')).toEqual({ orderId: 101, itemIndex: 0, piece: null })
  })
  it('новый формат с номером листа', () => {
    expect(parseLabelCode('MG-101-0-3')).toEqual({ orderId: 101, itemIndex: 0, piece: 3 })
  })
  it('маршрутный лист', () => {
    expect(parseLabelCode('MG-101')).toEqual({ orderId: 101, itemIndex: null, piece: null })
  })
  it('сканер отдаёт в нижнем регистре или с пробелами — всё равно читаем', () => {
    expect(parseLabelCode('  mg-101-2-1 ')).toEqual({ orderId: 101, itemIndex: 2, piece: 1 })
  })
  it('чужой код — null, а не догадка', () => {
    expect(parseLabelCode('4600123456789')).toBeNull()
    expect(parseLabelCode('MG-')).toBeNull()
    expect(parseLabelCode('')).toBeNull()
  })
  it('MG-0 не проходит: заказа с нулевым id не бывает', () => {
    expect(parseLabelCode('MG-0')).toBeNull()
  })
})
