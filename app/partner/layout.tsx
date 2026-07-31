import { getRole, isOwnerRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import PartnerNav from './PartnerNav'

// Кабинет партнёра: только роль 'partner' (и владельцы — для проверки).
// Собственное левое меню, без нашей внутренней навигации (RootLayout её прячет).
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || (role !== 'partner' && !isOwnerRole(role))) redirect('/')
  return (
    <div className="flex min-h-screen bg-[#f5f5f3]">
      <PartnerNav />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
