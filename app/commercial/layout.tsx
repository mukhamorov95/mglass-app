import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'

export default async function CommercialLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || !['admin', 'ceo', 'commercial'].includes(role)) redirect('/')
  return <>{children}</>
}
