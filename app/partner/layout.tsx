import { getRole, isOwnerRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import PartnerNav from './PartnerNav'
import PartnerTheme from './PartnerTheme'

// Кабинет партнёра: только роль 'partner' (и владельцы — для проверки).
// Собственная дизайн-система (.pcab, светлая+тёмная), своё левое меню —
// без внутренней навигации сотрудников (RootLayout её прячет).
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || (role !== 'partner' && !isOwnerRole(role))) redirect('/')
  return (
    <div className="pcab">
      <PartnerTheme />
      <PartnerNav />
      <main className="main">{children}</main>
    </div>
  )
}
