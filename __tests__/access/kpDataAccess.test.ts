import { describe, it, expect, vi, beforeEach } from 'vitest'

// /api/quotes/[id]/kp-data отдавал заказ любому вошедшему, если у заказа нет
// автора (4 275 из 5 258 старых заказов), и не проверял роль. Теперь калитка
// общая со счётом-спецификацией (lib/b2bOrderAccess).

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as Record<string, unknown> | null,
  order: null as Record<string, unknown> | null,
  ownsClient: false,
}))

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from: (table: string) => {
      const res = table === 'b2b_orders' ? h.order : table === 'users' ? h.profile : (h.ownsClient ? { id: 1 } : null)
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        single: async () => (res ? { data: res, error: null } : { data: null, error: { message: 'no rows' } }),
        maybeSingle: async () => ({ data: res, error: null }),
      }
      return chain
    },
  }),
}))

import { GET } from '@/app/api/quotes/[id]/kp-data/route'

const call = () => GET(new Request('http://localhost/api/quotes/7/kp-data'), { params: Promise.resolve({ id: '7' }) })

function as(role: string, permissions: Record<string, unknown> = {}) {
  h.user = { id: 'u-test' }
  h.profile = { role, see_all_orders: false, permissions }
}

beforeEach(() => {
  h.user = null
  h.profile = null
  h.ownsClient = false
  h.order = { id: 7, client_id: 3, created_by: null, items: [] }
})

describe('kp-data — старый заказ без автора', () => {
  it('менеджер видит', async () => {
    as('manager')
    expect((await call()).status).toBe(200)
  })

  it('цех, замерщик, маркетолог и партнёр — нет', async () => {
    for (const role of ['production', 'measurer', 'seo', 'partner']) {
      as(role)
      expect((await call()).status, role).toBe(403)
    }
  })

  it('закупщик с B2B-скоупом открывает экран, но старый чужой заказ не видит', async () => {
    as('buyer', { b2b_client_scope: 'all_clients' })
    expect((await call()).status).toBe(403)
  })

  it('свой заказ закупщик со скоупом видит', async () => {
    as('buyer', { b2b_client_scope: 'all_clients' })
    h.order = { id: 7, client_id: 3, created_by: 'u-test', items: [] }
    expect((await call()).status).toBe(200)
  })

  it('без сессии — 401, нет заказа — 404', async () => {
    expect((await call()).status).toBe(401)
    as('manager')
    h.order = null
    expect((await call()).status).toBe(404)
  })
})
