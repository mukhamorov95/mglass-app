import { getRole, isOwnerRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'

// Кабинет партнёра: только роль 'partner' (и владельцы — для проверки).
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || (role !== 'partner' && !isOwnerRole(role))) redirect('/')
  return <>{children}</>
}
