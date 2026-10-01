import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { NextRequest } from 'next/server'

// /api/calc/build и /api/calc/mirror проверяли только наличие сессии и отдавали
// себестоимость (₽/м² стекла, скидку M GLASS, закупку фурнитуры и подсветки).
// middleware не гейтит /api/*, поэтому партнёр, цех и замерщик звали их напрямую.
// Теперь эндпоинт пускает тех же, кого страница «Расчёт» (/calculator/build).
// Роли идут через настоящие getUserProfile + canAccessRoute; подменена только база.

const h = vi.hoisted(() => ({
  session: null as { id: string } | null,
  row: null as Record<string, unknown> | null,
  priceBuild: vi.fn(async () => ({ glassCost: 1, hardwareCost: 2, lines: [] })),
}))

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.session }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => (h.row ? { data: h.row, error: null } : { data: null, error: { message: 'no rows' } }),
        }),
      }),
    }),
  }),
}))

// Любая цепочка запросов service-role отвечает пустым списком — для ворот это неважно,
// а 200 у пропущенной роли доказывает, что маршрут дошёл до расчёта.
vi.mock('@/lib/supabase-service', () => {
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_t, k) => (k === 'then'
      ? (res: (v: unknown) => void) => res({ data: [], error: null })
      : () => chain),
  })
  return { createServiceClient: () => chain }
})

vi.mock('@/lib/calc/buildPrice', () => ({ priceBuild: h.priceBuild }))

import { POST as buildPOST } from '@/app/api/calc/build/route'
import { POST as mirrorPOST } from '@/app/api/calc/mirror/route'
import { GET as mirrorModelsGET } from '@/app/api/calc/mirror/models/route'
import { M_MODELS } from '@/lib/configurator/arrangement'

function as(role: string | null, permissions: Record<string, unknown> = {}) {
  h.session = { id: 'u-test' }
  h.row = role === null ? null : { role, permissions }
}

const post = (body: unknown) =>
  new Request('http://localhost/api/calc', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest

const buildBody = { model: M_MODELS[0].code, dims: { width: 900, height: 2000 } }
const mirrorBody = { width: 600, height: 800 }

const DENIED = ['partner', 'measurer', 'production', 'seo', 'accountant', 'office', 'logist', 'commercial', 'cfo', 'buyer']
const ALLOWED = ['manager', 'admin', 'ceo']

beforeEach(() => {
  h.session = null
  h.row = null
  h.priceBuild.mockClear()
})

describe('/api/calc/build — себестоимость только тем, кто открывает «Расчёт»', () => {
  it('партнёр получает 403, и расчёт даже не запускается', async () => {
    as('partner')
    const r = await buildPOST(post(buildBody))
    expect(r.status).toBe(403)
    const body = await r.json()
    expect(body).not.toHaveProperty('price')
    expect(h.priceBuild).not.toHaveBeenCalled()
  })

  it('менеджер получает 200 и цену', async () => {
    as('manager')
    const r = await buildPOST(post(buildBody))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ full: true, price: { glassCost: 1 } })
    expect(h.priceBuild).toHaveBeenCalledOnce()
  })

  it('роли без доступа к странице — 403', async () => {
    for (const role of DENIED) {
      as(role)
      expect((await buildPOST(post(buildBody))).status, role).toBe(403)
    }
    expect(h.priceBuild).not.toHaveBeenCalled()
  })

  it('менеджер и владелец — 200', async () => {
    for (const role of ALLOWED) {
      as(role)
      expect((await buildPOST(post(buildBody))).status, role).toBe(200)
    }
  })

  it('закупщик с кабинетом менеджера проходит, со скоупом B2B без кабинета — нет', async () => {
    as('buyer', { manager_workspace: true })
    expect((await buildPOST(post(buildBody))).status).toBe(200)
    as('buyer', { b2b_client_scope: 'mglass_only' })
    expect((await buildPOST(post(buildBody))).status).toBe(403)
  })

  it('без сессии — 401, без строки в users — 403', async () => {
    expect((await buildPOST(post(buildBody))).status).toBe(401)
    as(null)
    expect((await buildPOST(post(buildBody))).status).toBe(403)
  })
})

describe('/api/calc/mirror — тот же экран, те же ворота', () => {
  it('партнёр — 403 без строк себестоимости', async () => {
    as('partner')
    const r = await mirrorPOST(post(mirrorBody))
    expect(r.status).toBe(403)
    const body = await r.json()
    expect(body).not.toHaveProperty('price')
  })

  it('менеджер — 200', async () => {
    as('manager')
    const r = await mirrorPOST(post(mirrorBody))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ full: true })
  })

  it('витрина моделей зеркал: партнёр — 403, менеджер — 200', async () => {
    as('partner')
    expect((await mirrorModelsGET()).status).toBe(403)
    as('manager')
    expect((await mirrorModelsGET()).status).toBe(200)
  })
})

// Перепись: любой API-маршрут, который зовёт движок себестоимости, обязан стоять
// за гейтом роли. Список в чек-листе забывают; новый маршрут без гейта уронит тест.
const COST_PRODUCERS = ['priceBuild', 'calcMirrorQuote']
const ROLE_GATE = /\b(requirePageAccess|requireRole|requireOwner|requireAdmin|canSeeKitCost|canAccessRoute)\(/

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? routeFiles(p) : name === 'route.ts' ? [p] : []
  })
}

describe('перепись маршрутов с себестоимостью', () => {
  const files = routeFiles(join(process.cwd(), 'app/api'))

  it('находит хотя бы известные маршруты (проверка самой переписи)', () => {
    const importers = files.filter(f => COST_PRODUCERS.some(fn => new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b`).test(readFileSync(f, 'utf8'))))
    expect(importers.map(f => f.slice(f.indexOf('app/api')))).toEqual(
      expect.arrayContaining(['app/api/calc/build/route.ts', 'app/api/calc/mirror/route.ts']),
    )
  })

  it('каждый, кто импортирует движок себестоимости, проверяет роль', () => {
    const ungated = files.filter(f => {
      const src = readFileSync(f, 'utf8')
      const imports = COST_PRODUCERS.some(fn => new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b`).test(src))
      return imports && !ROLE_GATE.test(src)
    })
    expect(ungated.map(f => f.slice(f.indexOf('app/api')))).toEqual([])
  })
})
