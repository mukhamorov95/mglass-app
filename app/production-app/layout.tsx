import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getUserProfile } from '@/lib/getRole'
import { hasB2BSalesScope } from '@/lib/b2bScope'
import RegisterSW from './RegisterSW'

// Отдельный манифест цеха: установка открывает прямо /production-app.
export const metadata: Metadata = {
  manifest: '/production-app.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'MGlass Цех' },
  icons: { apple: '/icons/cex-512.png' },
}

const ALLOWED_ROLES = ['admin', 'ceo', 'manager', 'production'] as const

export default async function ProductionAppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getUserProfile()
  const role = profile?.role
  // Закупщик с B2B-скоупом (Вера) надзирает за производством.
  const scopedBuyer = role === 'buyer' && hasB2BSalesScope(profile?.permissions)
  const allowed = !!role && ((ALLOWED_ROLES as readonly string[]).includes(role) || scopedBuyer)
  if (!allowed) redirect('/')
  return <><RegisterSW />{children}</>
}
