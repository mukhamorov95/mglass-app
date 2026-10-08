import { describe, it, expect } from 'vitest'
import { parseLinkCode, botMode, linkLocked, afterFailedLink, linkUrl, LINK_MAX_FAILS } from '@/lib/telegramLink'

describe('привязка Telegram', () => {
  it('код по ссылке — всегда, голые цифры — только от непривязанного', () => {
    expect(parseLinkCode('/start 123456', true)).toBe('123456')
    expect(parseLinkCode('/start@mglass_assistant_bot 123456', false)).toBe('123456')
    expect(parseLinkCode(' 123456 ', false)).toBe('123456')
    expect(parseLinkCode('123456', true)).toBeNull()
    expect(parseLinkCode('/start', false)).toBeNull()
    expect(parseLinkCode('1234567', false)).toBeNull()
    expect(parseLinkCode('/start 12345a', false)).toBeNull()
  })
  it('ссылка ведёт в бота с кодом', () => {
    expect(linkUrl('123456')).toBe('https://t.me/mglass_assistant_bot?start=123456')
  })
  it('полный бот — только владельцу', () => {
    expect(botMode('admin')).toBe('full')
    expect(botMode('ceo')).toBe('full')
    expect(botMode('production')).toBe('notify')
    expect(botMode('manager')).toBe('notify')
    expect(botMode('partner')).toBe('notify')
    expect(botMode(null)).toBe('notify')
  })
  it('пять неверных за час — замок до конца часа', () => {
    const t0 = Date.parse('2026-10-08T10:00:00Z')
    let a = afterFailedLink(null, t0)
    for (let i = 1; i < LINK_MAX_FAILS; i++) a = afterFailedLink(a, t0 + i * 60_000)
    expect(a.fails).toBe(LINK_MAX_FAILS)
    expect(linkLocked(a, t0 + 10 * 60_000)).toBe(true)
    expect(linkLocked(a, t0 + 61 * 60_000)).toBe(false)
    expect(afterFailedLink(a, t0 + 61 * 60_000)).toEqual({ fails: 1, since: new Date(t0 + 61 * 60_000).toISOString() })
    expect(linkLocked(null, t0)).toBe(false)
  })
})
