import { describe, it, expect } from 'vitest'
import { queueCounts, queueTotal, settle, unpostedFrom, type QueueSnapshot } from '@/lib/accounting/queue'
import type { Finding } from '@/lib/accounting/audit'

const F = (code: string, severity: Finding['severity'], count = 1): Finding => ({ code, severity, title: code, detail: '', count })
const ok = <T,>(value: T) => ({ ok: true as const, value })

const snap = (o: Partial<QueueSnapshot> = {}): QueueSnapshot => ({
  today: '2026-10-07',
  bank: ok({ ip: 3, ooo: 1, total: 4 }),
  audit: ok([F('unposted_payments', 'high', 12), F('invoices_unpaid', 'normal', 5), F('month_open', 'low')]),
  upd: ok({ state: 'ok' as const, count: 2, noInn: 1, undated: 0, sum: 50000 }),
  invoices: ok({ count: 95, sum: 3987159 }),
  ...o,
})

describe('«Ждут действия» бухгалтера', () => {
  it('счётчики вкладок из одного среза', () => {
    expect(queueCounts(snap())).toEqual({ bank: 4, audit: 2, unposted: 12, upd: 2, invoices: 95 })
  })

  it('источник упал — ошибка словами, а не 0; в сумму не идёт', () => {
    const c = queueCounts(snap({ bank: { ok: false, error: 'timeout' } }))
    expect(c.bank).toEqual({ error: 'timeout' })
    expect(queueTotal(c)).toEqual({ total: 2 + 12 + 2 + 95, failed: 1 })
  })

  it('реестр УПД ещё не включён — счётчика нет (null), это не «0 ждут»', () => {
    expect(queueCounts(snap({ upd: ok({ state: 'pending_sql' as const }) })).upd).toBeNull()
  })

  it('проверка не собралась — и «Проверка», и «К проведению» говорят об ошибке', () => {
    const c = queueCounts(snap({ audit: { ok: false, error: 'payments: timeout' } }))
    expect(c.audit).toEqual({ error: 'payments: timeout' })
    expect(c.unposted).toEqual({ error: 'payments: timeout' })
  })

  it('settle ловит исключение источника', async () => {
    expect(await settle(async () => { throw new Error('нет связи') })).toEqual({ ok: false, error: 'нет связи' })
    expect(await settle(async () => 5)).toEqual({ ok: true, value: 5 })
  })

  it('окно «к проведению» — 180 дней, одно для карточки, вкладки и проверки', () => {
    expect(unpostedFrom('2026-10-07')).toBe('2026-04-10')
    expect(unpostedFrom('2026-03-01')).toBe('2025-09-02')
  })
})
