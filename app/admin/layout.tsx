import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'

const ALLOWED_ROLES = ['admin', 'buyer', 'ceo', 'cfo'] as const

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || !(ALLOWED_ROLES as readonly string[]).includes(role)) redirect('/')
  return <>{children}</>
}
