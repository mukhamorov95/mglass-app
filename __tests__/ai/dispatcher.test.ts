import { describe, it, expect } from 'vitest'
import { decideNextAction } from '@/lib/avito/dispatcher'
import { type LeadFlags } from '@/lib/avito/flags'

const CLOSED: LeadFlags = { measure_agreed: true, contact: true, address_known: true, object_ready: true }

describe('decideNextAction — автономный диспетчер', () => {
  it('пустой лид → collect (добираем)', () => {
    const d = decideNextAction({})
    expect(d.action).toBe('collect')
    expect(d.handoff).toBe(false)
    expect(d.toLost).toBe(false)
  })

  it('согласие+телефон+адрес+готовность → close_measure на «Замер назначен» + передача', () => {
    const d = decideNextAction(CLOSED)
    expect(d.action).toBe('close_measure')
    expect(d.stage).toBe('Замер назначен')
    expect(d.handoff).toBe(true)
  })

  it('согласился на замер, но нет адреса/готовности → ещё НЕ закрыт (collect)', () => {
    const d = decideNextAction({ measure_agreed: true, contact: true })
    expect(d.action).toBe('collect')
  })

  it('клиент отложил (stall) → park на «Долгострой», без передачи', () => {
    const d = decideNextAction({ product: true, sizes: true, stall: true })
    expect(d.action).toBe('park')
    expect(d.stage).toBe('Долгострой')
    expect(d.handoff).toBe(false)
  })

  it('дисквалификация → disqualify + в потерю + передача, приоритетнее всего', () => {
    const d = decideNextAction({ ...CLOSED, not_our_profile: true, stall: true })
    expect(d.action).toBe('disqualify')
    expect(d.toLost).toBe(true)
    expect(d.handoff).toBe(true)
  })

  it('close_measure приоритетнее park (даже если есть stall)', () => {
    const d = decideNextAction({ ...CLOSED, stall: true })
    expect(d.action).toBe('close_measure')
  })
})
