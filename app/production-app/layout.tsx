import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getRole } from '@/lib/getRole'
import RegisterSW from './RegisterSW'

// Отдельный манифест цеха: установка открывает прямо /production-app.
export const metadata: Metadata = {
  manifest: '/production-app.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'MGlass Цех' },
}

const ALLOWED_ROLES = ['admin', 'ceo', 'manager', 'production'] as const

export default async function ProductionAppLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || !(ALLOWED_ROLES as readonly string[]).includes(role)) redirect('/')
  return <><RegisterSW />{children}</>
}
