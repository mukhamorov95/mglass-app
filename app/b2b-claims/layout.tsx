import { redirect } from 'next/navigation'
import { getRole, isOwnerRole } from '@/lib/getRole'

// Гарантийные обращения партнёров — у владельца: ответ уходит партнёру в кабинет.
export default async function B2bClaimsLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!isOwnerRole(role)) redirect('/')
  return <>{children}</>
}
