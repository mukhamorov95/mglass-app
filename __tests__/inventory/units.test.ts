import { describe, it, expect } from 'vitest'
import {
  sheetArea, packToBase, baseToPack, describeQty, stockStatus, toOrderQty, formatQty,
} from '@/lib/inventory/units'

describe('единицы склада: тара ↔ база', () => {
  it('лист 3210×2250 = 7.2225 м²', () => {
    expect(sheetArea(3210, 2250)).toBe(7.2225)
  })

  it('вводим листы — получаем м²', () => {
    expect(packToBase(2, 7.2225)).toBe(14.445)
  })

  it('вводим хлысты уплотнителя 2.2 м', () => {
    expect(packToBase(5, 2.2)).toBe(11)
  })

  it('без тары количество не искажается', () => {
    expect(packToBase(7, 0)).toBe(7)
    expect(baseToPack(7, 0)).toBe(7)
  })

  it('остаток показывается и в м², и в листах', () => {
    expect(describeQty(18.1675, 'м2', 'лист', 7.2225)).toBe('18.17 м² (2.52 лист)')
    expect(describeQty(12, 'шт', null, 0)).toBe('12 шт')
  })

  it('штуки без дробей, площадь с двумя знаками', () => {
    expect(formatQty(12, 'шт')).toBe('12 шт')
    expect(formatQty(3.456, 'м2')).toBe('3.46 м²')
  })
})

describe('статус остатка', () => {
  const it0 = { qty: 0,  min_qty: 5, target_qty: 20 }
  const low = { qty: 4,  min_qty: 5, target_qty: 20 }
  const bel = { qty: 12, min_qty: 5, target_qty: 20 }
  const ok  = { qty: 25, min_qty: 5, target_qty: 20 }

  it('различает «нет», «мало», «ниже нормы», «норма»', () => {
    expect(stockStatus(it0)).toBe('out')
    expect(stockStatus(low)).toBe('low')
    expect(stockStatus(bel)).toBe('below_target')
    expect(stockStatus(ok)).toBe('ok')
  })

  it('без минимума и нормы позиция не считается дефицитной', () => {
    expect(stockStatus({ qty: 3, min_qty: 0, target_qty: 0 })).toBe('ok')
  })

  it('к дозакупке — разница до нормы, не отрицательная', () => {
    expect(toOrderQty(bel)).toBe(8)
    expect(toOrderQty(ok)).toBe(0)
    expect(toOrderQty({ qty: 2, min_qty: 5, target_qty: 0 })).toBe(3)
  })
})
