import { cache } from 'react'
import { createClient } from './supabase-server'
import type { UserPermissions } from './permissions'
import { DEFAULT_PERMISSIONS } from './permissions'

export type { UserPermissions }
export { DEFAULT_PERMISSIONS }

export type Role = 'admin' | 'manager' | 'production' | 'seo' | 'ceo' | 'buyer' | 'commercial' | 'cfo' | 'partner' | 'measurer' | 'accountant'

export type UserProfile = {
  role:        Role
  permissions: UserPermissions
  managerCode: number | null
  canDelete:   boolean
  maxDiscount: number
}

// ─── Owner / role helpers ────────────────────────────────────────────────────

// Roles with top-level (owner) access to every route, bypassing per-path allowlists.
export const OWNER_ROLES: Role[] = ['admin', 'ceo']

// Emergency bootstrap for the company owner: if their DB row is missing/broken,
// they still log in with admin rights. Real role from DB always wins when present.
const OWNER_BOOTSTRAP_EMAIL = 'admin@mglass.ru'

function isRole(r: unknown): r is Role {
  return r === 'admin' || r === 'manager' || r === 'production' ||
         r === 'seo'   || r === 'ceo'     || r === 'buyer' ||
         r === 'commercial' || r === 'cfo' || r === 'partner' || r === 'measurer' ||
         r === 'accountant'
}

// Case-insensitive normalisation. Accepts a few common UI aliases.
export function normalizeRole(r: unknown): Role | null {
  if (typeof r !== 'string') return null
  const v = r.trim().toLowerCase()
  if (v === 'owner') return 'admin'         // UI label "Owner" → admin tier
  if (v === 'commerce') return 'commercial' // tolerate truncation
  return isRole(v) ? v : null
}

export function isOwnerRole(role: Role | string | null | undefined): boolean {
  const r = normalizeRole(role)
  return r !== null && OWNER_ROLES.includes(r)
}

// ─── Session role fetch ──────────────────────────────────────────────────────

// supabase.auth.getUser() — сетевой вызов к GoTrue (валидирует JWT), НЕ чтение куки.
// Раньше он повторялся 3–4 раза на КАЖДУЮ навигацию (layout + getRole + getUserProfile
// + profiles). cache() схлопывает его в ОДИН вызов на серверный рендер/запрос —
// главная быстрая победа против «подвисаний».
export const getSessionUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

export const getRole = cache(async (): Promise<Role | null> => {
  const user = await getSessionUser()
  if (!user) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const r = normalizeRole(data?.role)
  if (r) return r

  // Emergency bootstrap — only when DB has nothing usable.
  if (user.email === OWNER_BOOTSTRAP_EMAIL) return 'admin'
  return null
})

export const getUserProfile = cache(async (): Promise<UserProfile | null> => {
  const user = await getSessionUser()
  if (!user) return null
  const supabase = await createClient()

  // Try full profile first (requires migrated columns); fall back to role-only
  const { data, error } = await supabase
    .from('users')
    .select('role, permissions, manager_code, can_delete, max_discount_percent')
    .eq('id', user.id)
    .single()

  if (error || !data) {
    // Columns may not exist yet — fall back to role-only query
    const { data: basic } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
    const role = normalizeRole(basic?.role) ??
      (user.email === OWNER_BOOTSTRAP_EMAIL ? ('admin' as const) : null)
    if (!role) return null
    return {
      role,
      permissions: { ...DEFAULT_PERMISSIONS },
      managerCode: null,
      canDelete:   isOwnerRole(role),
      maxDiscount: isOwnerRole(role) ? 100 : 5,
    }
  }

  const role = normalizeRole(data.role)
  if (!role) return null

  return {
    role,
    permissions: { ...DEFAULT_PERMISSIONS, ...(data.permissions as Partial<UserPermissions> ?? {}) },
    managerCode: data.manager_code ?? null,
    canDelete:   data.can_delete ?? false,
    maxDiscount: data.max_discount_percent ?? 5,
  }
})

// ─── Path access control ─────────────────────────────────────────────────────

// Per-role allowlist of route prefixes. Owner roles (admin, ceo) bypass this
// table via canAccessRoute — they have full access by definition.
export const ROLE_ALLOWED: Record<Role, string[]> = {
  admin: ['/'],
  ceo:   ['/'],

  manager: [
    '/',
    '/manager',
    '/installations',
    '/crm',
    '/sales',
    '/kp',
    '/contracts',
    '/calculator/quick',
    '/design-scan',
    '/calculator/mirror',
    '/calculator/shower',
    '/calculator/loft',
    '/calculations',
    '/orders',
    '/clients',
    '/calendar',
    '/measurer',
    '/measure-requests',
    '/measure-calendar',
    '/my-earnings',
    '/manager-dashboard',
    '/calculator/b2b',
    '/b2b-quotes',
    '/b2b-orders',
    '/b2b-crm',
    '/b2b-cutting',
    '/production-app',
  ],

  production: [
    '/',
    '/b2b-production',
    '/b2b-cutting',
    '/production-app',
    '/p/o',
  ],

  seo: [
    '/',
    '/b2b-analytics',
    '/marketing',
    '/ai-assistant',
    '/vladislav',
    '/ai-stats',
    '/kp-generator',
    '/amo-analysis',
    '/ai-sales',
  ],

  buyer: [
    '/',
    '/orders',
    '/b2b-orders',
    '/admin/shower-hardware',
    '/admin/hardware',
    '/admin/suppliers',
    '/admin/materials',
    '/admin/services',
    '/admin/glass-prices',
    '/admin/mirror-lighting',
    '/admin/mirror-frames',
    '/admin/facet',
    '/admin/guide',
    '/admin/route-sheet',
    '/admin/stock-control',
    '/admin/procurement',
    '/admin/cutting-settings',
    '/accounting',
  ],

  commercial: [
    '/',
    '/commercial',
    '/installations',
    '/crm',
    '/sales',
    '/manager',
    '/ceo',
    '/admin/users',
    '/admin/health-check',
  ],

  cfo: [
    '/',
    '/cfo',
    '/accounting',
    '/admin/cfo',
    '/admin/pnl',
    '/admin/settings',
    '/admin/dashboard',
    '/admin/analytics-mglass',
  ],

  // Бухгалтерия (Алёна, Екатерина): только свой раздел — ни маржи, ни CFO-дашбордов
  accountant: [
    '/',
    '/accounting',
  ],

  // Внешний B2B-партнёр: только свой кабинет. Видит лишь свои заказы (scoped по
  // b2b_clients.user_id на уровне API). Никакого доступа к внутренним разделам.
  partner: [
    '/',
    '/partner',
  ],

  // Замерщик: пул заявок, свой календарь, свои деньги.
  measurer: [
    '/',
    '/measurer-cabinet',
    '/measure-calendar',
  ],
}

// Per-user B2B scope flag. `mglass_only` unlocks a narrow B2B subset for a
// non-manager role (currently buyer) so a procurement worker can also do
// internal M GLASS quotes without becoming a full manager.
export type B2BScope = 'mglass_only' | 'all_clients' | null

// Paths a scoped buyer (mglass_only OR all_clients) gets on top of their normal
// allowlist. Intentionally narrow — the B2B quote/order flow plus the shop-floor
// production контур (Вера ведёт закупку и надзирает за производством). Does NOT
// include /my-earnings, /manager-dashboard, /calculator/mirror, etc. — that would
// be the full manager role and we don't want that.
const SCOPED_BUYER_B2B_PATHS: ReadonlyArray<string> = [
  '/calculator/b2b',
  '/b2b-quotes',
  '/b2b-orders',
  '/b2b-cutting',
  '/production-app',
  '/p/o',
]

// Centralised route gate. Use this everywhere instead of ad-hoc role checks.
// `opts.b2bScope` is optional — old 2-arg callers keep working unchanged.
export function canAccessRoute(
  role: Role | string | null | undefined,
  pathname: string,
  opts?: { b2bScope?: B2BScope | string | null },
): boolean {
  const r = normalizeRole(role)
  if (!r) return false
  if (isOwnerRole(r)) return true

  if (
    pathname === '/' ||
    pathname.startsWith('/api/') ||
    pathname === '/login' ||
    pathname === '/access-denied'
  ) return true

  const allowed = ROLE_ALLOWED[r] ?? []
  const matchAllow = (p: string) =>
    p === '/' ? pathname === '/' : (pathname === p || pathname.startsWith(p + '/'))
  if (allowed.some(matchAllow)) return true

  // Scoped extension: a buyer with a B2B scope (mglass_only or all_clients)
  // additionally gets the narrow B2B contour. Other roles ignore this opt.
  if (r === 'buyer' && (opts?.b2bScope === 'mglass_only' || opts?.b2bScope === 'all_clients')) {
    if (SCOPED_BUYER_B2B_PATHS.some(matchAllow)) return true
  }

  return false
}

// Back-compat alias — keep until call sites migrate.
export const canAccess = canAccessRoute
