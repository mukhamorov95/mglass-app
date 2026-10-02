import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  role: 'admin' as string | null,
  patches: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/getRole', () => ({ getRole: async () => h.role }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        h.patches.push(patch)
        return { eq: () => ({ select: async () => ({ data: [{ id: 1 }], error: null }) }) }
      },
      insert: async () => ({ error: null }),
    }),
  }),
}))

import { POST } from '@/app/api/cfo-settings/route'

const post = (body: unknown) => POST(new NextRequest('http://x/api/cfo-settings', { method: 'POST', body: JSON.stringify(body) }))

const ADMIN_CFO_BODY = {
  entity_type: 'ip', tax_system: 'usn_6', fixed_costs: { rent: 1 }, profit_split: { owner: 100 },
  avg_variable_pct: 62, monthly_revenue_target: 8_700_000,
}
const FUNDS = {
  drawing_per_shower: 1500, measure_per_shower: 2500, install_per_glass: 4500,
  delivery_moscow_per_order: 3500, delivery_region_per_order: 5000,
  tax_pct: 12, manager_pct: 3, realization_pct: 3, partner_reserve_pct: 3, partner_known_pct: 10, other_pct: 1,
}

describe('POST /api/cfo-settings — ставки фондов пишутся только пришедшими', () => {
  beforeEach(() => { h.role = 'admin'; h.patches = [] })

  it('сохранение экрана /admin/cfo не трогает order_funds', async () => {
    const res = await post(ADMIN_CFO_BODY)
    expect(res.status).toBe(200)
    expect(h.patches).toHaveLength(1)
    expect(h.patches[0]).not.toHaveProperty('order_funds')
    expect(h.patches[0]).toMatchObject(ADMIN_CFO_BODY)
  })

  it('пришедшие ставки пишутся целиком с датой записи', async () => {
    const res = await post({ order_funds: { ...FUNDS, as_of: '2020-01-01' } })
    expect(res.status).toBe(200)
    const written = h.patches[0].order_funds as Record<string, unknown>
    expect(written).toMatchObject(FUNDS)
    expect(written.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(written.as_of).not.toBe('2020-01-01')
    expect(h.patches[0]).not.toHaveProperty('avg_variable_pct')
  })

  it('неполный набор ставок отклоняется и ничего не пишет', async () => {
    const { other_pct: _drop, ...partial } = FUNDS
    void _drop
    const res = await post({ order_funds: partial })
    expect(res.status).toBe(400)
    expect(h.patches).toHaveLength(0)
  })

  it('менеджер получает 403', async () => {
    h.role = 'manager'
    const res = await post({ order_funds: FUNDS })
    expect(res.status).toBe(403)
    expect(h.patches).toHaveLength(0)
  })
})
