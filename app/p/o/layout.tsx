import { redirect } from 'next/navigation'
import { getRole, isOwnerRole } from '@/lib/getRole'

// QR-screen for shop-floor workers. Previously open to any authenticated user
// regardless of role — tightened alongside the production-tasks queue work so
// "who marked this" is trustworthy. Matches lib/getRole.ts ROLE_ALLOWED.production
// (the only non-owner role with /p/o in the middleware allowlist).
const ALLOWED_ROLES = ['production'] as const

export default async function POLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role) redirect('/login')
  if (!isOwnerRole(role) && !(ALLOWED_ROLES as readonly string[]).includes(role)) redirect('/access-denied')
  return <>{children}</>
}
