import { createBrowserClient } from '@supabase/ssr'

// Standard client — RLS on the database enforces tenant isolation automatically
// via the auth.org_id() function. Use this for auth and non-tenant queries.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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
