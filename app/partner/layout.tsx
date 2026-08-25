import type { Metadata, Viewport } from 'next'
import { getRole, isOwnerRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import PartnerNav from './PartnerNav'
import PartnerTheme from './PartnerTheme'
import RegisterSW from './RegisterSW'

// Кабинет партнёра: только роль 'partner' (и владельцы — для проверки).
// Собственная дизайн-система (.pcab, светлая+тёмная), своё левое меню —
// без внутренней навигации сотрудников (RootLayout её прячет).
// A10: отдельно устанавливаемое PWA — свой манифест, старт с /partner.
export const metadata: Metadata = {
  manifest: '/partner.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Кабинет' },
}
export const viewport: Viewport = {
  themeColor: '#141413',
}

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || (role !== 'partner' && !isOwnerRole(role))) redirect('/')
  return (
    <div className="pcab">
      <PartnerTheme />
      <RegisterSW />
      <PartnerNav />
      <main className="main">{children}</main>
    </div>
  )
}
