import { describe, it, expect } from 'vitest'
import { dealStage } from '@/lib/b2c/dealStatus'

describe('статус сделки — производная от расчётов', () => {
  it('нет расчётов → Новая', () => {
    expect(dealStage([]).key).toBe('new')
  })
  it('есть расчёт-черновик → Просчёт', () => {
    expect(dealStage([{ status: 'draft' }]).key).toBe('quote')
  })
  it('отправленное КП поднимает статус', () => {
    expect(dealStage([{ status: 'draft' }, { status: 'sent' }]).key).toBe('sent')
  })
  it('согласовано — высший из имеющихся', () => {
    expect(dealStage([{ status: 'sent' }, { status: 'approved' }]).key).toBe('approved')
  })
})
