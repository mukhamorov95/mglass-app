import { beforeEach, describe, expect, it, vi } from 'vitest'

const saved: Record<string, unknown>[] = []
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({ from: () => ({ upsert: async (row: Record<string, unknown>) => { saved.push(row); return { error: null } } }) }),
}))

const { withCronRun } = await import('@/lib/cronRuns')

const req = (auth?: string) => new Request('https://x/api/cron/sync', { headers: auth ? { authorization: auth } : {} })

describe('withCronRun', () => {
  beforeEach(() => { saved.length = 0; process.env.CRON_SECRET = 's3' })

  it('вызов без секрета в журнал не пишет', async () => {
    const res = await withCronRun('sync', req(), async () => Response.json({ error: 'forbidden' }, { status: 403 }))
    expect(res.status).toBe(403)
    expect(saved).toEqual([])
  })

  it('успех: старт, затем last_ok_at', async () => {
    await withCronRun('sync', req('Bearer s3'), async () => Response.json({ ok: true }))
    expect(saved.map(r => Object.keys(r).filter(k => k.startsWith('last_')).sort())).toEqual([
      ['last_started_at'], ['last_ms', 'last_ok_at'],
    ])
  })

  it('ok: false с кодом 200 — ошибка с текстом', async () => {
    await withCronRun('sync', req('Bearer s3'), async () => Response.json({ ok: false, error: 'книга закрыта' }))
    expect(saved[1]).toMatchObject({ job: 'sync', last_error: 'книга закрыта' })
    expect(saved[1]).not.toHaveProperty('last_ok_at')
  })

  it('исключение пишется и пробрасывается дальше', async () => {
    await expect(withCronRun('sync', req('Bearer s3'), async () => { throw new Error('таймаут') })).rejects.toThrow('таймаут')
    expect(saved[1]).toMatchObject({ last_error: 'таймаут' })
  })
})
