import { describe, expect, it } from 'vitest'
import { alertText, classifyAnthropicError, freshness, type LiveCheck } from '@/lib/health/liveChecks'

describe('classifyAnthropicError', () => {
  // Сообщение с экрана владельца 06.10, как его отдаёт SDK.
  const billing = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011"}'

  it('нет денег — красное, с действием про пополнение', () => {
    const v = classifyAnthropicError(400, billing)
    expect(v.status).toBe('fail')
    expect(v.detail).toMatch(/нет денег/)
    expect(v.action).toMatch(/Billing/)
  })
  it('ключ не принят — красное', () => {
    expect(classifyAnthropicError(401, '401 {"error":{"type":"authentication_error"}}').status).toBe('fail')
  })
  it('лимит и сбой провайдера — жёлтое: проходит само', () => {
    expect(classifyAnthropicError(429, 'rate_limit_error').status).toBe('warn')
    expect(classifyAnthropicError(529, 'overloaded_error').status).toBe('warn')
    expect(classifyAnthropicError(503, 'x').status).toBe('warn')
  })
  it('незнакомая ошибка — красное с её текстом', () => {
    expect(classifyAnthropicError(400, 'что-то новое')).toMatchObject({ status: 'fail', detail: expect.stringMatching(/что-то новое/) })
  })
})

describe('freshness', () => {
  const now = new Date('2026-10-06T09:00:00Z')
  const opts = { what: '«Маржа»', schedule: 'в 8:10 МСК', action: 'проверить книгу' }
  it('обновлено сегодня — зелёное', () => {
    expect(freshness('2026-10-06T05:10:00Z', now, opts)).toMatchObject({ status: 'ok' })
  })
  it('вчерашнее утро — ещё норма (сутки с запасом)', () => {
    expect(freshness('2026-10-05T08:00:00Z', now, opts).status).toBe('ok')
  })
  it('не прошёл сегодня — жёлтое, два дня — красное', () => {
    expect(freshness('2026-10-05T05:10:00Z', now, opts).status).toBe('warn')
    expect(freshness('2026-10-03T05:10:00Z', now, opts)).toMatchObject({ status: 'fail', detail: expect.stringMatching(/3 дня назад/) })
  })
  it('ни одного обновления — красное', () => {
    expect(freshness(null, now, opts).status).toBe('fail')
  })
})

describe('alertText', () => {
  const c = (id: string, status: LiveCheck['status'], detail = 'd'): LiveCheck => ({ id, title: id, status, detail })
  it('без красного — молчим', () => {
    expect(alertText([c('a', 'ok'), c('b', 'warn')], 'u')).toBeNull()
  })
  it('красное и жёлтое — одним сообщением, HTML экранирован', () => {
    const t = alertText([c('ai', 'fail', 'нет <денег>'), c('q', 'warn'), c('ok', 'ok')], 'https://app/x')!
    expect(t).toMatch(/Не работает: 1/)
    expect(t).toMatch(/Требует внимания: 1/)
    expect(t).toContain('нет &lt;денег&gt;')
    expect(t).not.toContain('<b>ok</b>')
  })
})
