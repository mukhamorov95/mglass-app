import { createBrowserClient } from '@supabase/ssr'

// Блокировка token-refresh supabase-js через Web Locks (navigator.locks) иногда
// «залипает» — lock, удержанный умершим/зависшим контекстом, не освобождается, и
// ЛЮБОЙ auth-вызов (getUser/getSession/запрос с рефрешем) виснет навсегда → страница
// крутит «Загрузка…». Здесь lock с таймаутом ТОЛЬКО на ЗАХВАТ: если за отведённое
// время не взяли — выполняем операцию без блокировки (лучше редкая гонка рефреша,
// чем вечное зависание). Когда lock свободен — работает как обычно (fn ровно один раз).
const LOCK_ACQUIRE_MAX_MS = 2500   // supabase шлёт 10с — слишком близко к таймауту страницы; жёстко режем
async function safeLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks) return fn()
  const ac = new AbortController()
  const wait = Math.min(acquireTimeout > 0 ? acquireTimeout : LOCK_ACQUIRE_MAX_MS, LOCK_ACQUIRE_MAX_MS)
  const timer = setTimeout(() => ac.abort(), wait)
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
//
// SINGLETON на вкладку: раньше каждый вызов создавал НОВЫЙ GoTrueClient со своим
// авто-рефрешем токена. Десятки экземпляров на странице → десятки таймеров рефреша,
// грызущихся за один auth-lock (navigator.locks) → повышенный риск дедлока и зависаний
// «Загрузка…». Один клиент на вкладку — один рефреш, минимум борьбы за замок.

// Прокси через свой домен: у части сотрудников провайдер режет *.supabase.co
// (ERR_CONNECTION_RESET). Клиент оставляем на РЕАЛЬНОМ Supabase-URL (чтобы ключи
// сессий/куки не менялись), но каждый сетевой запрос перенаправляем на
// same-origin /supabase/* — его Vercel проксирует на Supabase (см. next.config
// rewrites). Так браузер вообще не обращается к supabase.co напрямую.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

function proxiedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof window !== 'undefined') {
    const orig = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input)
    if (orig.startsWith(SUPABASE_URL)) {
      const proxied = window.location.origin + '/supabase' + orig.slice(SUPABASE_URL.length)
      return input instanceof Request ? fetch(new Request(proxied, input)) : fetch(proxied, init)
    }
  }
  return fetch(input as RequestInfo, init)
}

// Тип клиента выводим из фактического вызова (makeBrowserClient), а НЕ из
// `ReturnType<typeof createBrowserClient>` — последнее разрешается в широкий
// перегруз, из-за чего auth.getUser() терял типы и деструктуризация { user }
// падала как implicit-any на сборке.
function makeBrowserClient() {
  return createBrowserClient(
    SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { lock: safeLock }, global: { fetch: proxiedFetch } }
  )
}

let browserClient: ReturnType<typeof makeBrowserClient> | undefined

export function createClient() {
  if (!browserClient) browserClient = makeBrowserClient()
  return browserClient
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
