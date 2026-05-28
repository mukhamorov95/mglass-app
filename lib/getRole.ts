import { createClient } from './supabase-server'
import type { UserPermissions } from './permissions'
import { DEFAULT_PERMISSIONS } from './permissions'

export type { UserPermissions }
export { DEFAULT_PERMISSIONS }

export type Role = 'admin' | 'manager' | 'production' | 'seo' | 'ceo' | 'buyer' | 'commercial' | 'cfo'

export type UserProfile = {
  role:        Role
  permissions: UserPermissions
  managerCode: number | null
  canDelete:   boolean
  maxDiscount: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRole(r: unknown): r is Role {
  return r === 'admin' || r === 'manager' || r === 'production' ||
         r === 'seo'   || r === 'ceo'     || r === 'buyer' || r === 'commercial' || r === 'cfo'
}

export async function getRole(): Promise<Role | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  return isRole(data?.role) ? data!.role : null
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

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
    if (!basic || !isRole(basic.role)) return null
    return {
      role:        basic.role as Role,
      permissions: { ...DEFAULT_PERMISSIONS },
      managerCode: null,
      canDelete:   basic.role === 'admin',
      maxDiscount: basic.role === 'admin' ? 100 : 5,
    }
  }

  if (!isRole(data.role)) return null

  return {
    role:        data.role as Role,
    permissions: { ...DEFAULT_PERMISSIONS, ...(data.permissions as Partial<UserPermissions> ?? {}) },
    managerCode: data.manager_code ?? null,
    canDelete:   data.can_delete ?? false,
    maxDiscount: data.max_discount_percent ?? 5,
  }
}

// ─── Path access control ─────────────────────────────────────────────────────

export const ROLE_ALLOWED: Record<Role, string[]> = {
  admin: ['/'],

  manager: [
    '/',
    '/manager',
    '/calculator/mirror',
    '/calculator/shower',
    '/calculator/loft',
    '/calculations',
    '/orders',
    '/clients',
    '/calendar',
    '/measurer',
    '/my-earnings',
    '/manager-dashboard',
    '/calculator/b2b',
    '/b2b-quotes',
    '/b2b-orders',
    '/b2b-cutting',
  ],

  production: [
    '/',
    '/b2b-pipeline',
    '/b2b-production',
    '/production',
    '/b2b-orders',
    '/manager-dashboard',
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
    '/admin/procurement-routes',
    '/admin/cutting-settings',
  ],

  commercial: [
    '/',
    '/commercial',
    '/manager',
    '/ceo',
    '/admin/users',
    '/admin/health-check',
  ],

  cfo: [
    '/',
    '/cfo',
    '/admin/cfo',
    '/admin/pnl',
    '/admin/settings',
    '/admin/dashboard',
    '/admin/analytics-mglass',
  ],

  ceo: [
    '/',
    '/cfo',
    '/ceo',
    '/commercial',
    '/admin/owner',
    '/admin/dashboard',
    '/admin/pnl',
    '/admin/cfo',
    '/admin/analytics-mglass',
    '/admin/bonus-center',
    '/admin/sales-center',
    '/admin/b2b-development',
    '/admin/org',
    '/admin/users',
    '/vladislav',
    '/b2b-analytics',
    '/marketing',
    '/ai-stats',
    '/amo-analysis',
    '/ai-sales',
    '/admin/roadmap',
    '/admin/owner-questionnaire',
    '/admin/pricing-manual',
    '/admin/health-check',
    '/admin/ai-control-center',
  ],
}

export function canAccess(role: Role, pathname: string): boolean {
  if (role === 'admin') return true
  const allowed = ROLE_ALLOWED[role] ?? []
  if (
    pathname === '/' ||
    pathname.startsWith('/api/') ||
    pathname === '/login' ||
    pathname === '/access-denied'
  ) return true
  return allowed.some(p => p === '/' || pathname === p || pathname.startsWith(p + '/'))
}
