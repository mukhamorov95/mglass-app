import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

import { can, permsOf, TEAM_ROLES } from '@/lib/partner/teamRoles'
import { denyUnless, resolvePartnerMember } from '@/lib/partnerClient'

describe('матрица прав команды партнёра', () => {
  it('кладовщик не видит цен и денег, но видит заказы и получение', () => {
    const p = permsOf('storekeeper')
    expect(p).toMatchObject({ prices: false, calc: false, payStatus: false, finance: false, team: false, delivery: true, claims: true })
  })
  it('бухгалтер — деньги и документы, без калькулятора и команды', () => {
    expect(permsOf('accountant')).toMatchObject({ prices: true, payStatus: true, finance: true, calc: false, team: false })
  })
  it('менеджер — просчёты и статус оплаты, без реквизитов и команды', () => {
    expect(permsOf('manager')).toMatchObject({ prices: true, calc: true, payStatus: true, finance: false, team: false })
  })
  it('команду ведёт только руководитель, и у него всё', () => {
    for (const r of TEAM_ROLES) expect(can(r, 'team')).toBe(r === 'admin')
    expect(Object.values(permsOf('admin')).every(Boolean)).toBe(true)
  })
  it('отказ — 403 с причиной', async () => {
    const res = denyUnless('storekeeper', 'prices')!
    expect(res.status).toBe(403)
    expect((await res.json()).perm).toBe('prices')
    expect(denyUnless('admin', 'finance')).toBeNull()
  })
})

type Row = Record<string, unknown>
function fakeSvc(t: { clients: Row[]; members: Row[]; users?: Row[] }) {
  const tables: Record<string, Row[]> = { b2b_clients: t.clients, b2b_client_members: t.members, users: t.users ?? [] }
  return {
    from(name: string) {
      const filters: [string, unknown][] = []
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
        maybeSingle: async () => ({ data: (tables[name] ?? []).find(r => filters.every(([k, v]) => r[k] === v)) ?? null, error: null }),
      }
      return q
    },
  } as never
}

describe('резолвер сотрудника партнёра', () => {
  const clients = [{ id: 2, user_id: 'boss' }]
  it('основной вход карточки — руководитель', async () => {
    const m = await resolvePartnerMember(fakeSvc({ clients, members: [] }), 'boss')
    expect(m).toMatchObject({ client: { id: 2 }, role: 'admin', preview: false })
  })
  it('сотрудник получает роль из строки команды', async () => {
    const m = await resolvePartnerMember(fakeSvc({ clients, members: [{ user_id: 'sk', client_id: 2, role: 'storekeeper', disabled_at: null }] }), 'sk')
    expect(m?.role).toBe('storekeeper')
  })
  it('отключённый и с неизвестной ролью — без доступа', async () => {
    expect(await resolvePartnerMember(fakeSvc({ clients, members: [{ user_id: 'x', client_id: 2, role: 'manager', disabled_at: '2026-11-24' }] }), 'x')).toBeNull()
    expect(await resolvePartnerMember(fakeSvc({ clients, members: [{ user_id: 'y', client_id: 2, role: 'boss', disabled_at: null }] }), 'y')).toBeNull()
    expect(await resolvePartnerMember(fakeSvc({ clients, members: [] }), 'stranger')).toBeNull()
  })
})
