import { describe, it, expect } from 'vitest'
import { parseClaimPatch, causeSummary } from '@/lib/partner/claims'

describe('правка гарантийного обращения владельцем', () => {
  it('в работу — без ответа можно', () => {
    expect(parseClaimPatch({ id: 3, status: 'in_review' })).toEqual({ ok: true, id: 3, patch: { status: 'in_review', resolution: null } })
  })
  it('закрыть без ответа партнёру нельзя', () => {
    const r = parseClaimPatch({ id: 3, status: 'resolved', resolution: '  ' })
    expect(r.ok).toBe(false)
  })
  it('решено с ответом и причиной «вина размера»', () => {
    expect(parseClaimPatch({ id: 3, status: 'resolved', resolution: 'Переделали за счёт партнёра', cause: 'size' }))
      .toEqual({ ok: true, id: 3, patch: { status: 'resolved', resolution: 'Переделали за счёт партнёра', cause: 'size' } })
  })
  it('причина не передана — не трогаем; пустая — снимаем; чужая — отказ', () => {
    const none = parseClaimPatch({ id: 3, status: 'open' })
    expect(none.ok && 'cause' in none.patch).toBe(false)
    const cleared = parseClaimPatch({ id: 3, status: 'open', cause: '' })
    expect(cleared.ok && cleared.patch.cause).toBeNull()
    expect(parseClaimPatch({ id: 3, status: 'open', cause: 'weather' }).ok).toBe(false)
  })
  it('неизвестный статус и пустой id — отказ', () => {
    expect(parseClaimPatch({ id: 3, status: 'done' }).ok).toBe(false)
    expect(parseClaimPatch({ status: 'open' }).ok).toBe(false)
  })
  it('сводка по причинам для Т5', () => {
    expect(causeSummary([{ cause: 'size' }, { cause: 'size' }, { cause: 'defect' }, { cause: null }]))
      .toEqual({ size: 2, defect: 1, transport: 0, other: 0, none: 1 })
  })
})
