import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { NextRequest } from 'next/server'

// Деньги и доступ b2b_orders / b2b_clients (02.10.2026). Правило держит триггер в базе
// (supabase/migrations/20261002_b2b_money_columns_guard.sql, пробы ролями — в PR), а здесь
// то, что база проверить не может:
//  • её списки совпадают с кодом — роли калькулятора и ключи оплаты в notes;
//  • сервис-ключ триггер пропускает, поэтому серверный маршрут, который кладёт в notes
//    ключи из тела запроса, отсеивает их сам (дыра /stages: payment_status через patch);
//  • ключи оплаты и согласования в патчах встречаются только у своих писателей.

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  rpc: [] as { fn: string; args: unknown }[],
}))

function fakeDb() {
  const from = (table: string) => {
    const filters: [string, unknown][] = []
    const rows = () => (h.tables[table] ?? []).filter(r => filters.every(([c, v]) => r[c] === v))
    const b: Record<string, unknown> = {}
    const self = () => b
    Object.assign(b, {
      select: self, in: self, is: self, order: self, limit: self, update: self,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'no rows' } }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res),
    })
    return b
  }
  return {
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from,
    rpc: async (fn: string, args: unknown) => { h.rpc.push({ fn, args }); return { data: null, error: null } },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createClient: async () => fakeDb() }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeDb() }))
vi.mock('@/lib/inventory/consumeHook', () => ({ consumeForOrder: async () => ({}) }))

import { canAccessRoute, isOwnerRole, ROLE_ALLOWED, type Role } from '@/lib/getRole'
import { SERVER_ONLY_NOTE_KEYS } from '@/lib/b2b/orderNotes'
import { POST as stagesPOST } from '@/app/api/b2b-orders/[id]/stages/route'

const root = process.cwd()
const migration = readFileSync(join(root, 'supabase/migrations/20261002_b2b_money_columns_guard.sql'), 'utf8')

describe('списки в базе совпадают с кодом', () => {
  it('роли, которым база даёт править деньги просчёта, — те, кому открыт /calculator/b2b', () => {
    const m = migration.match(/function public\.b2b_money_editor_roles\(\)[\s\S]*?array\[([^\]]*)\]/)
    expect(m, 'b2b_money_editor_roles не найдена в миграции').not.toBeNull()
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort()
    const scopes = [null, 'mglass_only', 'all_clients'] as const
    const inCode = (Object.keys(ROLE_ALLOWED) as Role[])
      .filter(r => !isOwnerRole(r) && scopes.some(s => canAccessRoute(r, '/calculator/b2b', { b2bScope: s })))
      .sort()
    expect(inSql).toEqual(inCode)
  })

  it('ключи notes, закрытые для браузера, — SERVER_ONLY_NOTE_KEYS и stages.invoice_paid', () => {
    const body = migration.match(/function public\._b2b_order_money_keys[\s\S]*?end \$\$;/)
    expect(body, '_b2b_order_money_keys не найдена в миграции').not.toBeNull()
    const inSql = [...body![0].matchAll(/^\s*'([a-z_.]+)',/gm)].map(x => x[1]).sort()
    expect(inSql).toEqual([...SERVER_ONLY_NOTE_KEYS, 'stages.invoice_paid'].sort())
  })
})

const req = (body: unknown) =>
  new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest
const ctx = { params: Promise.resolve({ id: '9001' }) }

function as(role: string) {
  h.user = { id: 'u-test' }
  h.tables.users = [{ id: 'u-test', role, name: 'Тест', permissions: {} }]
  h.tables.b2b_orders = [{ id: 9001, notes: '{"status":"sent","stages":{}}' }]
}

describe('/api/b2b-orders/[id]/stages: patch пишет только ключи экрана заказов', () => {
  beforeEach(() => { h.user = null; h.tables = {}; h.rpc = [] })

  it.each(['manager', 'production', 'buyer'])('%s: patch с отметкой оплаты — 400, база не тронута', async role => {
    as(role)
    for (const patch of [
      { payment_status: 'paid' }, { prepayment_amount: 1 }, { paid_at: '2026-10-02' },
      { price_approval: { resolution: 'approved' } }, { stages: { invoice_paid: '2026-10-02' } },
    ]) {
      const r = await stagesPOST(req({ patch }), ctx)
      expect(r.status, JSON.stringify(patch)).toBe(400)
    }
    expect(h.rpc).toEqual([])
  })

  it('оплата этапом — 400, как и раньше', async () => {
    as('manager')
    const r = await stagesPOST(req({ stages: { invoice_paid: '2026-10-02' } }), ctx)
    expect(r.status).toBe(400)
    expect(h.rpc).toEqual([])
  })

  it('ключи экрана заказов проходят, патч — ровно они', async () => {
    as('manager')
    const patch = { material_status: 'ordered', material_status_updated_at: '2026-10-02T10:00:00Z', material_status_updated_by: 'u-test' }
    const r = await stagesPOST(req({ patch }), ctx)
    expect(r.status).toBe(200)
    expect(h.rpc).toEqual([{ fn: 'patch_order_notes_shallow', args: { p_order_id: 9001, p_patch: patch } }])
  })

  it('партнёр и замерщик маршрут не открывают', async () => {
    for (const role of ['partner', 'measurer']) {
      as(role)
      expect((await stagesPOST(req({ patch: { material_status: 'ordered' } }), ctx)).status).toBe(403)
    }
    expect(h.rpc).toEqual([])
  })
})

describe('перепись: ключи оплаты и согласования в патчах notes — только у своих писателей', () => {
  // Сервис-ключ триггер не останавливает: новый серверный маршрут, который пишет эти
  // ключи, должен попасть сюда осознанно, с причиной.
  const WRITERS: Record<string, string[]> = {
    'app/api/b2b-orders/[id]/payment/route.ts': ['invoice_paid', 'paid_at', 'payment_status', 'prepayment_amount'],
    'app/api/b2b-quotes/[id]/adjust-total/route.ts': ['price_approval', 'total_history'],
    'app/api/b2b-orders/[id]/adjust-total/route.ts': ['total_history'],
    'app/api/b2b-quotes/[id]/price-approval/route.ts': ['price_approval'],
  }
  const KEYS = [...SERVER_ONLY_NOTE_KEYS, 'invoice_paid']

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap(n => {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : files(p)
      return /\.(ts|tsx)$/.test(n) ? [p] : []
    })
  }

  const found: Record<string, string[]> = {}
  let callers = 0
  for (const p of ['app', 'lib', 'components'].flatMap(d => files(join(root, d)))) {
    // Комментарии не пишут в базу; «https://» в строках не встречается рядом с ключами.
    const s = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    if (!/rpc\(\s*['"](patch_order_notes_shallow|mark_order_stages)['"]/.test(s)) continue
    callers++
    const keys = KEYS.filter(k => new RegExp(`\\b${k}\\s*:`).test(s)).sort()
    if (keys.length) found[p.slice(root.length + 1)] = keys
  }

  it('нашёл вызовы патча (иначе тест слепой)', () => {
    expect(callers).toBeGreaterThan(15)
  })

  it('ключи оплаты/согласования пишут только перечисленные маршруты', () => {
    expect(found).toEqual(Object.fromEntries(Object.entries(WRITERS).map(([f, k]) => [f, [...k].sort()])))
  })
})
