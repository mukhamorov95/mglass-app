import { createClient } from './supabase-server'

export type Role = 'admin' | 'manager' | 'production' | 'seo' | 'ceo'

export async function getRole(): Promise<Role | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const r = data?.role
  if (r === 'admin' || r === 'manager' || r === 'production' || r === 'seo' || r === 'ceo') return r
  return null
}

// Paths each role is allowed to access (prefix match).
// admin gets everything. All roles get /api/ and /login.
export const ROLE_ALLOWED: Record<Role, string[]> = {
  admin: ['/'],

  manager: [
    '/',
    '/calculator/mirror',
    '/calculator/shower',
    '/calculator/loft',
    '/calculations',
    '/orders',
    '/clients',
    '/calendar',
    '/measurer',
    '/manager-dashboard',
    '/calculator/b2b',
    '/b2b-quotes',
    '/b2b-orders',
    '/b2b-crm',
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

  ceo: [
    '/',
    '/admin/owner',
    '/admin/dashboard',
    '/admin/pnl',
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
  ],
}

export function canAccess(role: Role, pathname: string): boolean {
  if (role === 'admin') return true
  const allowed = ROLE_ALLOWED[role] ?? []
  // Always allow root, API, login, access-denied
  if (
    pathname === '/' ||
    pathname.startsWith('/api/') ||
    pathname === '/login' ||
    pathname === '/access-denied'
  ) return true
  return allowed.some(p => p === '/' || pathname === p || pathname.startsWith(p + '/'))
}
