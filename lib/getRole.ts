import { cache } from 'react'
import { createClient } from './supabase-server'
import type { UserPermissions } from './permissions'
import { DEFAULT_PERMISSIONS } from './permissions'

export type { UserPermissions }
export { DEFAULT_PERMISSIONS }

export type Role = 'admin' | 'manager' | 'production' | 'seo' | 'ceo' | 'buyer' | 'commercial' | 'cfo' | 'partner' | 'measurer' | 'accountant' | 'office' | 'logist'

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
         r === 'accountant' || r === 'office' || r === 'logist'
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
    '/configurator',
    '/calculator/loft',
    '/calculator/railing',
    '/calculations',
    '/cart',            // корзина мультизаказа B2C + «КП (PDF)» (/cart/print) — без неё менеджер не сформирует КП
    '/orders',
    '/clients',
    '/calendar',
    '/measurer',
    '/measure-requests',
    '/measure-calendar',
    '/my-earnings',
    '/manager-dashboard',
    '/calculator/b2b',
    '/b2b-today',
    '/b2b-deal',
    '/b2b-quotes',
    '/b2b-orders',
    '/b2b-invoices',
    '/b2b-crm',
    '/b2b-cutting',
    '/production-app',
    '/inventory',
  ],

  production: [
    '/',
    '/b2b-production',
    '/b2b-cutting',
    '/production-app',
    '/inventory',
    '/p/o',
  ],

  seo: [
    '/',
    '/b2b-analytics',
    '/b2b-growth',
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
    '/admin/supplier-catalog',
    '/admin/visualizer-pricing',
    '/admin/materials',
    '/admin/services',
    '/admin/glass-prices',
    '/admin/glass-price-lists',
    '/admin/mirror-lighting',
    '/admin/mirror-frames',
    '/admin/facet',
    '/admin/guide',
    '/admin/route-sheet',
    '/admin/stock-control',
    '/admin/procurement',
    '/inventory',
    '/admin/cutting-settings',
    '/accounting',
  ],

  commercial: [
    '/',
    '/commercial',
    '/b2b-invoices',
    '/b2b-deal',
    '/inventory',
    '/b2b-growth',
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
    '/b2b-invoices',
    '/inventory',
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

  // Офис-менеджер: координация — счета, КП, клиенты, календарь, задачи (CRM).
  // Без маржи, себестоимости и CFO-дашбордов.
  office: [
    '/',
    '/clients',
    '/calendar',
    '/kp',
    '/contracts',
    '/orders',
    '/b2b-invoices',
    '/measure-requests',
    '/measure-calendar',
    '/crm',
  ],

  // Логистика: планирование монтажей и доставок + просмотр заказов под них.
  logist: [
    '/',
    '/installations',
    '/calendar',
    '/measure-calendar',
    '/orders',
    '/b2b-orders',
  ],
}

// Домашний экран роли: куда отправлять с корня «/», чтобы человек попадал сразу
// в свой раздел, а не на менеджерскую панель. manager/admin/ceo не в карте —
// они остаются на «/» (общая панель / Owner Center). Пути входят в ROLE_ALLOWED
// соответствующей роли, поэтому canAccessRoute их не отбивает.
export const ROLE_HOME: Partial<Record<Role, string>> = {
  partner:    '/partner',
  production: '/production-app',
  buyer:      '/inventory',
  office:     '/crm',
  logist:     '/installations',
  measurer:   '/measurer-cabinet',
  accountant: '/accounting',
  cfo:        '/cfo',
  commercial: '/commercial',
  seo:        '/marketing',
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
  opts?: { b2bScope?: B2BScope | string | null; managerWorkspace?: boolean },
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

  // Manager-workspace extension: a buyer with manager_workspace (Вера) additionally
  // gets the full manager contour (MGlass B2C + B2B) on top of the buyer/logist one.
  if (r === 'buyer' && opts?.managerWorkspace) {
    if ((ROLE_ALLOWED.manager ?? []).some(matchAllow)) return true
  }

  return false
}

// Back-compat alias — keep until call sites migrate.
export const canAccess = canAccessRoute

// То же решение, что canAccessRoute, но с человеческой причиной — для экрана
// диагностики прав. Держать в синхроне с canAccessRoute (один путь решения).
export function explainAccess(
  role: Role | string | null | undefined,
  pathname: string,
  opts?: { b2bScope?: B2BScope | string | null; managerWorkspace?: boolean },
): { allowed: boolean; reason: string } {
  const r = normalizeRole(role)
  if (!r) return { allowed: false, reason: 'нет роли' }
  if (isOwnerRole(r)) return { allowed: true, reason: 'владелец (admin/ceo) — доступ ко всему' }
  if (pathname === '/' || pathname.startsWith('/api/') || pathname === '/login' || pathname === '/access-denied') {
    return { allowed: true, reason: 'общедоступный путь' }
  }
  const allowed = ROLE_ALLOWED[r] ?? []
  const matchAllow = (p: string) => p === '/' ? pathname === '/' : (pathname === p || pathname.startsWith(p + '/'))
  const hit = allowed.find(matchAllow)
  if (hit) return { allowed: true, reason: `в списке роли «${r}» (${hit})` }
  if (r === 'buyer' && (opts?.b2bScope === 'mglass_only' || opts?.b2bScope === 'all_clients')) {
    const sHit = SCOPED_BUYER_B2B_PATHS.find(matchAllow)
    if (sHit) return { allowed: true, reason: `B2B-контур закупщика (скоуп ${opts.b2bScope}, ${sHit})` }
  }
  if (r === 'buyer' && opts?.managerWorkspace) {
    const mHit = (ROLE_ALLOWED.manager ?? []).find(matchAllow)
    if (mHit) return { allowed: true, reason: `менеджерский контур закупщика (manager_workspace, ${mHit})` }
  }
  return { allowed: false, reason: `не в списке роли «${r}»` }
}
