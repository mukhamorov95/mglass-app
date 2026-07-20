import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'

export default async function AccountingLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || !['admin', 'ceo', 'cfo', 'accountant', 'buyer'].includes(role)) redirect('/')
  return <>{children}</>
}
