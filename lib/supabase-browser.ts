import { createBrowserClient } from '@supabase/ssr'

// Блокировка token-refresh supabase-js через Web Locks (navigator.locks) иногда
// «залипает» — lock, удержанный умершим/зависшим контекстом, не освобождается, и
// ЛЮБОЙ auth-вызов (getUser/getSession/запрос с рефрешем) виснет навсегда → страница
// крутит «Загрузка…». Здесь lock с таймаутом ТОЛЬКО на ЗАХВАТ: если за отведённое
// время не взяли — выполняем операцию без блокировки (лучше редкая гонка рефреша,
// чем вечное зависание). Когда lock свободен — работает как обычно (fn ровно один раз).
async function safeLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks) return fn()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), acquireTimeout > 0 ? acquireTimeout : 5000)
  try {
    return await locks.request(name, { signal: ac.signal }, async () => fn())
  } catch {
    // не смогли взять lock за таймаут (или он залип) — выполняем без блокировки
    return await fn()
  } finally {
    clearTimeout(timer)
  }
}

// Standard client — RLS on the database enforces tenant isolation automatically
// via the auth.org_id() function. Use this for auth and non-tenant queries.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { lock: safeLock } }
  )
}

// Org-scoped wrapper — returns helpers that automatically add organization_id
// filters to every query. Use this for all B2B data queries in components.
// RLS is the primary security layer; this adds defense-in-depth and makes
// the tenant boundary explicit in application code.
export function createScopedClient(orgId: number) {
  const sb = createClient()

  return {
    // Raw client — for auth calls, storage, realtime, etc.
    sb,

    // The current org id, useful for building INSERT payloads manually.
    orgId,

    // fromOrg(table, columns?) returns a select FilterBuilder pre-filtered by org.
    // It's a drop-in for sb.from(table).select(columns) with the org filter already applied.
    // Chain any additional filters after it: .order(), .limit(), .filter(), etc.
    // Usage: const { data } = await fromOrg('b2b_clients', 'id,name').order('name')
    // Return cast to `any` because Supabase's conditional types infer GenericStringError
    // when columns is a runtime string (not a literal). RLS + run-time validation catch errors.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fromOrg(table: string, columns = '*'): any {
      return sb.from(table).select(columns).eq('organization_id', orgId)
    },

    // insertOrg injects organization_id automatically.
    // Usage: await insertOrg('b2b_clients', { name: 'ACME', discount_percent: 10 })
    async insertOrg<T extends Record<string, unknown>>(table: string, row: T) {
      return sb.from(table).insert({ ...row, organization_id: orgId })
    },
  }
}

export type ScopedClient = ReturnType<typeof createScopedClient>
