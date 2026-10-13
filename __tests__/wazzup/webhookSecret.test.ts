import { describe, expect, it } from 'vitest'
import { checkWazzupSecret, wazzupWebhookSecret } from '@/lib/wazzupWebhookSecret'

describe('секрет вебхука Wazzup', () => {
  it('выводится из ключа API, стабильно и без самого ключа', () => {
    const a = wazzupWebhookSecret({ WAZZUP_API_KEY: 'key-1' })
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(wazzupWebhookSecret({ WAZZUP_API_KEY: 'key-1' })).toBe(a)
    expect(wazzupWebhookSecret({ WAZZUP_API_KEY: 'key-2' })).not.toBe(a)
    expect(a).not.toContain('key-1')
  })

  it('явная переменная важнее выведенного', () => {
    expect(wazzupWebhookSecret({ WAZZUP_WEBHOOK_SECRET: 'explicit', WAZZUP_API_KEY: 'key-1' })).toBe('explicit')
  })

  it('нет ни ключа, ни переменной — секрета нет', () => {
    expect(wazzupWebhookSecret({})).toBeNull()
    expect(checkWazzupSecret('x', null)).toBe('unconfigured')
  })

  it('совпал / не передан / чужой', () => {
    const s = wazzupWebhookSecret({ WAZZUP_API_KEY: 'key-1' })
    expect(checkWazzupSecret(s, s)).toBe('ok')
    expect(checkWazzupSecret(null, s)).toBe('missing')
    expect(checkWazzupSecret('', s)).toBe('missing')
    expect(checkWazzupSecret('0'.repeat(32), s)).toBe('bad')
    expect(checkWazzupSecret('short', s)).toBe('bad')
  })
})
