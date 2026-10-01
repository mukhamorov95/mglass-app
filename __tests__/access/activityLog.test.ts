import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { auditAccess, SENSITIVE_TABLES, type AccessSnapshot } from '@/lib/security/accessAudit'

// До 01.10.2026 журнал activity_log писался ключом пользователя, RLS без политик
// отбивал каждую запись, ошибку никто не читал — 0 строк при сиквенсе 171.
// Теперь пишет только lib/activityLog.ts через service-role, автор — из сессии.

const h = vi.hoisted(() => ({
  session: null as { id: string; email?: string } | null,
  profile: null as { name: string | null; email: string | null } | null,
  insertError: null as { message: string } | null,
  inserted: [] as Record<string, unknown>[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.session }, error: null }) },
  }),
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === 'users' ? h.profile : null, error: null }) }),
      }),
      insert: async (row: Record<string, unknown>) => {
        if (table === 'activity_log' && !h.insertError) h.inserted.push(row)
        return { data: null, error: h.insertError }
      },
    }),
  }),
}))

import { writeLogForCurrentUser } from '@/lib/activityLog'

describe('writeLogForCurrentUser', () => {
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    h.session = null; h.profile = null; h.insertError = null; h.inserted = []
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => errSpy.mockRestore())

  it('автор — из сессии, имя — из users', async () => {
    h.session = { id: 'u-1', email: 'a@example.test' }
    h.profile = { name: 'Сотрудник', email: 'a@example.test' }
    await writeLogForCurrentUser('order.update', { entityType: 'b2b_client_requisites', entityId: '7', details: { fields: ['bank_account'] } })
    expect(h.inserted).toEqual([{
      user_id: 'u-1', user_name: 'Сотрудник', action: 'order.update',
      entity_type: 'b2b_client_requisites', entity_id: '7', details: { fields: ['bank_account'] },
    }])
  })

  it('без сессии не пишет и говорит об этом в лог', async () => {
    await writeLogForCurrentUser('user.update')
    expect(h.inserted).toEqual([])
    expect(errSpy).toHaveBeenCalled()
  })

  it('отказ базы не ломает основное действие, но и не молчит', async () => {
    h.session = { id: 'u-1' }
    h.insertError = { message: 'permission denied for table activity_log' }
    await expect(writeLogForCurrentUser('user.permission_change')).resolves.toBeUndefined()
    expect(errSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('[activityLog]'))).toBe(true)
  })
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('кто пишет в activity_log', () => {
  const files = ['app', 'lib', 'components'].flatMap(d => walk(join(process.cwd(), d)))
  const touching = files.filter(f => /from\(\s*['"]activity_log['"]\s*\)/.test(readFileSync(f, 'utf8')))

  it('пишет только lib/activityLog.ts, читает только экран журнала', () => {
    const rel = touching.map(f => f.slice(process.cwd().length + 1)).sort()
    expect(rel).toEqual(['app/admin/activity-log/page.tsx', 'lib/activityLog.ts'])
  })

  it('экран журнала только читает', () => {
    const page = readFileSync(join(process.cwd(), 'app/admin/activity-log/page.tsx'), 'utf8')
    expect(page).not.toMatch(/\.(insert|update|upsert|delete)\(/)
  })

  it('функции, принимающей чужой user_id, нет', () => {
    const src = readFileSync(join(process.cwd(), 'lib/activityLog.ts'), 'utf8')
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+writeLog\s*\(/)
    expect(src).toMatch(/auth\.getUser\(\)/)
  })
})

describe('прогон доступов знает про activity_log', () => {
  const base: AccessSnapshot = { policies: [], grants: [], rls: [], suspicious_columns: [] }

  it('таблица в SENSITIVE_TABLES', () => {
    expect(SENSITIVE_TABLES.has('activity_log')).toBe(true)
  })

  it('снимок после миграции 20261001 находок по журналу не даёт', () => {
    const f = auditAccess({
      ...base,
      policies: [{ table: 'activity_log', policy: 'activity_log_owner_read', cmd: 'r', roles: ['authenticated'], using: 'is_owner()', check: null }],
      grants: [{ table: 'activity_log', grantee: 'authenticated', privilege: 'SELECT' }],
      rls: [{ table: 'activity_log', enabled: true, policies: 1 }],
    })
    expect(f).toEqual([])
  })

  it('снимок до миграции прогон видел: RLS без политик и гранты анонима на запись', () => {
    const f = auditAccess({
      ...base,
      grants: ['INSERT', 'UPDATE', 'DELETE'].map(privilege => ({ table: 'activity_log', grantee: 'anon', privilege })),
      rls: [{ table: 'activity_log', enabled: true, policies: 0 }],
    })
    expect(f.map(x => x.code).sort()).toEqual(['anon_write_grants_dormant', 'rls_no_policies'])
  })
})
