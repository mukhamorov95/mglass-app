import { describe, it, expect } from 'vitest'
import { orderAmount, isLive, isLaunched, isQuote, canonicalClient, isOwnRetail } from '@/lib/liveOrders'

// Ошибка в этих предикатах = неверная выручка на всех экранах сразу.
describe('orderAmount — одна формула суммы на весь проект', () => {
  it('после скидки важнее суммы с НДС', () => {
    expect(orderAmount({ total_after_discount: 90_000, total_sale_inc_vat: 100_000 })).toBe(90_000)
  })
  it('без скидки берём с НДС', () => {
    expect(orderAmount({ total_after_discount: null, total_sale_inc_vat: 100_000 })).toBe(100_000)
  })
  it('скидка 0 — это НЕ отсутствие скидки, но и не повод падать', () => {
    expect(orderAmount({ total_after_discount: 0, total_sale_inc_vat: 100_000 })).toBe(0)
  })
  it('пусто — ноль, а не NaN', () => {
    expect(orderAmount({})).toBe(0)
    expect(orderAmount({ total_after_discount: null, total_sale_inc_vat: null })).toBe(0)
  })
})

describe('три сущности в одной таблице', () => {
  const архивный = { archived_at: '2026-05-01', launched_at: '2026-05-01' }
  const просчёт  = { archived_at: null, launched_at: null }
  const в_работе = { archived_at: null, launched_at: '2026-07-10' }

  it('архивный не живой и не в работе — это дубль импорта (53,2 млн ₽)', () => {
    expect(isLive(архивный)).toBe(false)
    expect(isLaunched(архивный)).toBe(false)
    expect(isQuote(архивный)).toBe(false)
  })
  it('просчёт живой, но НЕ выручка — намерение, а не деньги', () => {
    expect(isLive(просчёт)).toBe(true)
    expect(isLaunched(просчёт)).toBe(false)
    expect(isQuote(просчёт)).toBe(true)
  })
  it('заказ в работе — и живой, и выручка', () => {
    expect(isLive(в_работе)).toBe(true)
    expect(isLaunched(в_работе)).toBe(true)
    expect(isQuote(в_работе)).toBe(false)
  })
  it('просчёт и заказ не пересекаются', () => {
    for (const o of [архивный, просчёт, в_работе]) {
      expect(isLaunched(o) && isQuote(o)).toBe(false)
    }
  })
})

describe('юрлица одного клиента', () => {
  it('все имена MR GLASS сводятся к одному', () => {
    for (const n of ['MR GLASS (ООО ЛЮДИ)', 'ВРНГЛАЗИЕРС', 'ООО МОНАРХ', 'ООО ЛЮДИ']) {
      expect(canonicalClient(n)).toBe('MR GLASS')
    }
  })
  it('чужие имена не трогаются', () => {
    expect(canonicalClient('AveoGlass')).toBe('AveoGlass')
    expect(canonicalClient('СпецМонтаж')).toBe('СпецМонтаж')
  })
  it('пусто не роняет', () => {
    expect(canonicalClient(null)).toBe('—')
    expect(canonicalClient('  ')).toBe('—')
  })
  it('собственная розница опознаётся и не считается клиентом', () => {
    expect(isOwnRetail('M GLASS')).toBe(true)
    expect(isOwnRetail('M  GLASS')).toBe(true)
    expect(isOwnRetail('MGLASS')).toBe(true)
    expect(isOwnRetail('MR GLASS')).toBe(false)
    expect(isOwnRetail('MR GLASS (ООО ЛЮДИ)')).toBe(false)
  })
})
