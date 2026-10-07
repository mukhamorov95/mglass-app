import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeDb, fakeClient } from './fakeSupabase'

const sent: { chat: number; text: string }[] = []
vi.mock('@/lib/telegram', () => ({
  sendMessage: vi.fn(async (chat: number, text: string) => {
    if (chat === 666) return { ok: false, description: 'bot was blocked by the user' }
    sent.push({ chat, text })
    return { ok: true }
  }),
}))

import { notifyAccountants } from '@/lib/accounting/notifyAccountants'
import { digest } from '@/lib/accounting/audit'
import type { SupabaseClient } from '@supabase/supabase-js'

const svc = (db: ReturnType<typeof makeDb>) => fakeClient(db) as unknown as SupabaseClient

describe('утренняя сводка — бухгалтерам с привязанным Telegram', () => {
  beforeEach(() => { sent.length = 0; process.env.TELEGRAM_BOT_TOKEN = 'test' })

  it('шлёт только бухгалтерам с привязкой; уволенным и другим ролям — нет', async () => {
    const db = makeDb({
      users: [
        { id: 'a1', role: 'accountant', active: true },
        { id: 'a2', role: 'accountant', active: null },
        { id: 'a3', role: 'accountant', active: false },
        { id: 'a4', role: 'accountant', active: true },
        { id: 'm1', role: 'manager', active: true },
      ],
      telegram_users: [
        { telegram_id: 101, user_id: 'a1' },
        { telegram_id: 102, user_id: 'a2' },
        { telegram_id: 103, user_id: 'a3' },
        { telegram_id: 201, user_id: 'm1' },
      ],
    })
    const r = await notifyAccountants(svc(db), 'сводка')
    expect(r).toEqual({ accountants: 3, linked: 2, sent: 2 })
    expect(sent.map(s => s.chat).sort()).toEqual([101, 102])
  })

  it('не доставлено — видно в итоге (sent < linked), а не молча', async () => {
    const db = makeDb({
      users: [{ id: 'a1', role: 'accountant', active: true }],
      telegram_users: [{ telegram_id: 666, user_id: 'a1' }],
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await notifyAccountants(svc(db), 'сводка')).toEqual({ accountants: 1, linked: 1, sent: 0 })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('чтение упало — исключение, а не «0 бухгалтеров»', async () => {
    const db = makeDb({ users: [{ id: 'a1', role: 'accountant' }] })
    db.failTable = 'users'
    await expect(notifyAccountants(svc(db), 'сводка')).rejects.toThrow(/бухгалтеры не прочитаны/)
  })

  it('сводка экранирует «<» и «&» для HTML-режима Telegram', () => {
    const text = digest([{ code: 'x', severity: 'high', title: 'Зарплата <аванс>', detail: 'ИП & ООО' }])
    expect(text).toContain('Зарплата &lt;аванс&gt;')
    expect(text).toContain('ИП &amp; ООО')
  })
})
