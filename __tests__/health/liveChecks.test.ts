import { describe, expect, it } from 'vitest'
import { OWNER_SQL, alertText, classifyAnthropicError, cronVerdicts, freshness, ownerSqlVerdict, type CronRunRow, type LiveCheck } from '@/lib/health/liveChecks'

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

describe('cronVerdicts', () => {
  const now = new Date('2026-10-07T07:00:00Z')
  const jobs = [
    { job: 'sync', title: 'Синк', maxHours: 26 },
    { job: 'leads', title: 'Заявки', maxHours: 1 },
  ]
  const row = (job: string, r: Partial<CronRunRow>): CronRunRow =>
    ({ job, last_started_at: null, last_ok_at: null, last_error: null, last_error_at: null, ...r })

  it('всё прошло — одна сводная строка', () => {
    const v = cronVerdicts([
      row('sync', { last_started_at: '2026-10-07T05:00:00Z', last_ok_at: '2026-10-07T05:00:40Z' }),
      row('leads', { last_started_at: '2026-10-07T06:55:00Z', last_ok_at: '2026-10-07T06:55:03Z' }),
    ], now, jobs)
    expect(v).toEqual([expect.objectContaining({ id: 'crons', status: 'ok', detail: '2 из 2 проходят по расписанию' })])
  })

  it('журнал пуст — ждём первых запусков, это не поломка', () => {
    expect(cronVerdicts([], now, jobs)[0]).toMatchObject({ status: 'ok', detail: 'Журнал включён, ждём первых запусков' })
  })

  it('ошибка новее успеха — красное с текстом ошибки', () => {
    const v = cronVerdicts([
      row('sync', { last_ok_at: '2026-10-06T05:00:40Z', last_error_at: '2026-10-07T05:00:20Z', last_error: 'HTTP 500: книга закрыта' }),
    ], now, jobs)
    expect(v).toEqual([expect.objectContaining({ id: 'cron_sync', status: 'fail' })])
    expect(v[0].detail).toContain('книга закрыта')
  })

  it('успех старше нормы — красное', () => {
    const v = cronVerdicts([row('leads', { last_started_at: '2026-10-07T05:00:00Z', last_ok_at: '2026-10-07T05:00:02Z' })], now, jobs)
    expect(v[0]).toMatchObject({ id: 'cron_leads', status: 'fail' })
  })

  it('старт без завершения дольше 15 минут — жёлтое; идущий сейчас — норма', () => {
    const killed = cronVerdicts([
      row('sync', { last_ok_at: '2026-10-06T05:01:00Z', last_started_at: '2026-10-07T05:00:00Z' }),
    ], now, jobs)
    expect(killed[0]).toMatchObject({ id: 'cron_sync', status: 'warn' })
    const running = cronVerdicts([
      row('leads', { last_ok_at: '2026-10-07T06:50:02Z', last_started_at: '2026-10-07T06:55:00Z' }),
    ], now, jobs)
    expect(running[0]).toMatchObject({ id: 'crons', status: 'ok', detail: '1 из 2 проходят по расписанию, 1 ещё не запускались с включения журнала' })
  })
})

describe('ownerSqlVerdict', () => {
  it('всё выполнено — зелёное; не выполнено — жёлтое с файлами и путём', () => {
    expect(ownerSqlVerdict([]).status).toBe('ok')
    const v = ownerSqlVerdict(OWNER_SQL)
    expect(v.status).toBe('warn')
    expect(v.detail).toContain('Не выполнен SQL (2)')
    expect(v.action).toContain('supabase/migrations/20261006_cron_runs.sql')
    expect(v.action).toContain('SQL Editor')
  })
})
