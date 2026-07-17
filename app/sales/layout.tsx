import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || !['admin', 'ceo', 'manager', 'commercial'].includes(role)) redirect('/')
  return <>{children}</>
}
