import { describe, it, expect, vi, beforeEach } from 'vitest'

let cookieValue: string | undefined
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (cookieValue === undefined ? undefined : { value: cookieValue }) }) }))

import { previewClientId, previewWriteGuard } from '@/lib/partnerPreview'
import type { SupabaseClient } from '@supabase/supabase-js'

// Поддельный клиент базы: роль пользователя и признак is_test у клиента.
function fakeSvc(role: string | null, isTest = false): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === 'users' ? (role ? { role } : null) : { is_test: isTest }, error: null }) }) }),
    }),
  } as unknown as SupabaseClient
}

describe('«Смотреть как партнёр» — только у владельца', () => {
  beforeEach(() => { cookieValue = undefined })

  it('без куки режима нет', async () => expect(await previewClientId(fakeSvc('admin'), 'u')).toBeNull())
  it('владелец с кукой смотрит выбранного клиента', async () => {
    cookieValue = '71'
    expect(await previewClientId(fakeSvc('admin'), 'u')).toBe(71)
    expect(await previewClientId(fakeSvc('ceo'), 'u')).toBe(71)
  })
  it('партнёр и менеджер с такой кукой ничего не получают', async () => {
    cookieValue = '10'
    expect(await previewClientId(fakeSvc('partner'), 'u')).toBeNull()
    expect(await previewClientId(fakeSvc('manager'), 'u')).toBeNull()
    expect(await previewClientId(fakeSvc(null), 'u')).toBeNull()
  })
  it('мусор в куке не принимается', async () => {
    for (const v of ['abc', '-5', '0', '1.5', '']) {
      cookieValue = v
      expect(await previewClientId(fakeSvc('admin'), 'u')).toBeNull()
    }
  })
})

describe('в режиме просмотра от имени партнёра ничего не пишется', () => {
  beforeEach(() => { cookieValue = undefined })

  it('без режима запись разрешена', async () => expect(await previewWriteGuard(fakeSvc('admin'), 'u')).toBeNull())
  it('настоящий клиент — 403 с понятной причиной', async () => {
    cookieValue = '10'
    const r = await previewWriteGuard(fakeSvc('admin', false), 'u', { allowOnTest: true })
    expect(r?.status).toBe(403)
    expect(await r?.json()).toEqual({ error: expect.stringContaining('Режим просмотра') })
  })
  it('тестовый клиент — настройки можно, остальное нельзя', async () => {
    cookieValue = '71'
    expect(await previewWriteGuard(fakeSvc('admin', true), 'u', { allowOnTest: true })).toBeNull()
    expect((await previewWriteGuard(fakeSvc('admin', true), 'u'))?.status).toBe(403)
  })
  it('партнёр с подложенной кукой пишет как обычно — своё', async () => {
    cookieValue = '71'
    expect(await previewWriteGuard(fakeSvc('partner'), 'u')).toBeNull()
  })
})
