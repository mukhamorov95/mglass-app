import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assignUpdNumber, loadUpdRegistered } from '@/lib/b2b/updRegistry'
import { documentSafeNotes, documentSafeItems } from '@/lib/b2b/publicQuote'

const sbWith = (res: { data: unknown; error: { code?: string; message: string } | null }) => ({
  rpc: async () => res,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => res }) }) }),
}) as unknown as SupabaseClient

describe('реестр УПД', () => {
  it('до SQL владельца — без номера и без ошибки', async () => {
    const missing = { data: null, error: { code: '42P01', message: 'relation "upd_registry" does not exist' } }
    expect(await loadUpdRegistered(sbWith(missing), 1)).toBeNull()
    expect(await assignUpdNumber(sbWith({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }), 1, '2026-10-05', { id: 'u', name: null }))
      .toEqual({ registered: null, pendingSql: true })
  })

  it('номер из функции — первая строка ответа', async () => {
    const row = { year: 2026, number: 17, doc_date: '2026-10-05' }
    expect(await assignUpdNumber(sbWith({ data: [row], error: null }), 1, '2026-10-05T12:00:00Z', { id: 'u', name: 'Яна' }))
      .toEqual({ registered: row, pendingSql: false })
  })

  it('прочая ошибка базы не глотается', async () => {
    await expect(loadUpdRegistered(sbWith({ data: null, error: { code: '57014', message: 'timeout' } }), 1)).rejects.toThrow('timeout')
  })
})

describe('документ партнёра: дата УПД та же, что у менеджера', () => {
  it('отметка «Отгружен» уходит датой, сами этапы — нет', () => {
    const out = JSON.parse(documentSafeNotes(JSON.stringify({ launched_at: '2026-09-17', stages: { shipped: '2026-10-05', cut: '2026-09-20' } }))!)
    expect(out).toEqual({ launched_at: '2026-09-17', shipped_date: '2026-10-05' })
  })
  it('признак цены из прайса клиента доходит до счёта партнёра', () => {
    expect(documentSafeItems([{ saleIncVat: 100, clientPriced: true }])[0].clientPriced).toBe(true)
  })
})
