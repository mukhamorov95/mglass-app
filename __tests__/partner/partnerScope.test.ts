import { describe, it, expect, vi, beforeEach } from 'vitest'

// Чертежи и вложения заказа (/api/b2b/drawing, /api/b2b/attachments) резолвили
// партнёра только по b2b_clients.user_id. Участник команды партнёра (A6,
// b2b_client_members) получал 404 на файлы собственных заказов.

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

const db = vi.hoisted(() => ({
  clients: [] as { id: number; user_id: string | null }[],
  members: [] as { client_id: number; user_id: string }[],
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: async () => {
            const rows: Record<string, unknown>[] = table === 'b2b_clients' ? db.clients : table === 'b2b_client_members' ? db.members : []
            return { data: rows.find(r => r[col] === val) ?? null, error: null }
          },
        }),
      }),
    }),
  }),
}))

import { getPartnerClientId, partnerOwnsOrder } from '@/lib/partnerScope'

beforeEach(() => {
  db.clients = [{ id: 10, user_id: 'owner-of-10' }, { id: 20, user_id: 'owner-of-20' }]
  db.members = [{ client_id: 10, user_id: 'member-of-10' }]
})

describe('getPartnerClientId — как во всём кабинете', () => {
  it('основной логин партнёра → его карточка', async () => {
    expect(await getPartnerClientId('owner-of-10')).toBe(10)
  })
  it('участник команды → карточка компании', async () => {
    expect(await getPartnerClientId('member-of-10')).toBe(10)
  })
  it('чужой логин → null', async () => {
    expect(await getPartnerClientId('stranger')).toBeNull()
  })
  it('участник видит заказы своей компании и не видит чужие', async () => {
    expect(await partnerOwnsOrder('member-of-10', 10)).toBe(true)
    expect(await partnerOwnsOrder('member-of-10', 20)).toBe(false)
    expect(await partnerOwnsOrder('member-of-10', null)).toBe(false)
  })
})
