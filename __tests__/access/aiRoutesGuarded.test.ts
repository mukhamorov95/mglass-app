import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { NextResponse } from 'next/server'

// /api/ai/* проверяли только наличие сессии, а middleware /api/* не гейтит.
// Партнёр, цех и замерщик могли звать ИИ-чат с инструментами на service-role,
// одобрять КП из /admin/ai-proposals и тратить токены. Теперь маршрут пускает
// тех, кому открыт экран, который его вызывает (requirePageAccess / requireAnyPageAccess).

const h = vi.hoisted(() => ({
  session: null as { id: string } | null,
  row: null as Record<string, unknown> | null,
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

import { requireAnyPageAccess, requirePageAccess } from '@/lib/apiAuth'
import { POST as parseIdeaPOST } from '@/app/api/ai/parse-idea/route'

function as(role: string | null, permissions: Record<string, unknown> = {}) {
  h.session = { id: 'u-test' }
  h.row = role === null ? null : { role, permissions }
}

const status = async (g: Promise<unknown>) => {
  const r = await g
  return r instanceof NextResponse ? r.status : 200
}

beforeEach(() => {
  h.session = null
  h.row = null
})

describe('requireAnyPageAccess — пускает, если открыт хотя бы один экран', () => {
  it('цех проходит на свой экран и не проходит на чужой', async () => {
    as('production')
    expect(await status(requireAnyPageAccess(['/b2b-crm', '/production-app/ideas']))).toBe(200)
    expect(await status(requireAnyPageAccess(['/b2b-crm', '/admin/ai-proposals']))).toBe(403)
  })

  it('партнёр не проходит ни на один внутренний экран', async () => {
    as('partner')
    for (const p of ['/ai-sales', '/ai-assistant', '/admin/ai-proposals', '/calculator/b2b', '/b2b-crm', '/contracts']) {
      expect(await status(requirePageAccess(p)), p).toBe(403)
    }
  })

  it('владелец проходит, без сессии — 401, без строки в users — 403', async () => {
    as('admin')
    expect(await status(requireAnyPageAccess(['/admin/ai-proposals']))).toBe(200)
    h.session = null
    expect(await status(requireAnyPageAccess(['/b2b-crm']))).toBe(401)
    as(null)
    expect(await status(requireAnyPageAccess(['/b2b-crm']))).toBe(403)
  })
})

describe('маршрут отказывает до разбора запроса', () => {
  it('партнёр на /api/ai/parse-idea — 403', async () => {
    as('partner')
    const r = await parseIdeaPOST(new Request('http://localhost/api/ai/parse-idea', { method: 'POST', body: '{}' }))
    expect(r.status).toBe(403)
  })
})

// Перепись: каждый обработчик под /api/ai первой строкой проверяет доступ.
// Новый маршрут без ворот уронит этот тест.
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? routeFiles(p) : n === 'route.ts' ? [p] : []
  })
}

describe('перепись /api/ai: ворота в каждом обработчике', () => {
  const files = routeFiles(join(process.cwd(), 'app/api/ai'))

  it('маршруты найдены', () => expect(files.length).toBeGreaterThan(20))

  it('первая инструкция каждого обработчика — require*', () => {
    const missing: string[] = []
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!/^export async function (GET|POST|PUT|PATCH|DELETE)\b/.test(line)) return
        let j = i
        while (!lines[j].trimEnd().endsWith('{')) j++
        const first = lines.slice(j + 1).find(l => l.trim() && !l.trim().startsWith('//')) ?? ''
        if (!/await require(Owner|Admin|Role|PageAccess|AnyPageAccess)\(/.test(first)) {
          missing.push(`${f.replace(process.cwd() + '/', '')}:${i + 1}`)
        }
      })
    }
    expect(missing).toEqual([])
  })
})
