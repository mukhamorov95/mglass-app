import { describe, it, expect } from 'vitest'
import { decideNextAction } from '@/lib/avito/dispatcher'
import { type LeadFlags } from '@/lib/avito/flags'

const PORTRAIT: LeadFlags = { product: true, sizes: true, finish_known: true, contact: true }

describe('decideNextAction — диспетчер бота', () => {
  it('пустой лид → collect', () => {
    const d = decideNextAction({})
    expect(d.action).toBe('collect')
    expect(d.handoff).toBe(false)
  })

  it('портрет собран → handoff, этап не трогаем', () => {
    const d = decideNextAction(PORTRAIT)
    expect(d.action).toBe('handoff')
    expect(d.handoff).toBe(true)
    expect(d.stage).toBeNull()
  })

  it('спросил цену при изделии и размерах → handoff', () => {
    expect(decideNextAction({ product: true, sizes: true, price_asked: true }).action).toBe('handoff')
  })

  it('отложил без портрета → park на «Долгострой»', () => {
    const d = decideNextAction({ product: true, stall: true })
    expect(d.action).toBe('park')
    expect(d.stage).toBe('Долгострой')
  })

  it('портрет собран, но отложил → всё равно менеджеру', () => {
    expect(decideNextAction({ ...PORTRAIT, stall: true }).action).toBe('handoff')
  })

  it('дисквалификация приоритетнее всего', () => {
    const d = decideNextAction({ ...PORTRAIT, not_our_profile: true })
    expect(d.action).toBe('disqualify')
    expect(d.toLost).toBe(true)
  })
})
