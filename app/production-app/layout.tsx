import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getUserProfile } from '@/lib/getRole'
import { isMGlassOnlyUser } from '@/lib/b2bScope'
import RegisterSW from './RegisterSW'

// Отдельный манифест цеха: установка открывает прямо /production-app.
export const metadata: Metadata = {
  manifest: '/production-app.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'MGlass Цех' },
}

const ALLOWED_ROLES = ['admin', 'ceo', 'manager', 'production'] as const

export default async function ProductionAppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getUserProfile()
  const role = profile?.role
  // Scoped buyer (Вера, b2b_client_scope='mglass_only') надзирает за производством.
  const scopedBuyer = role === 'buyer' && isMGlassOnlyUser(profile?.permissions)
  const allowed = !!role && ((ALLOWED_ROLES as readonly string[]).includes(role) || scopedBuyer)
  if (!allowed) redirect('/')
  return <><RegisterSW />{children}</>
}
