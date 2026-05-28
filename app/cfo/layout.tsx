import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'

export default async function CfoLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || !['admin', 'ceo', 'cfo'].includes(role)) redirect('/')
  return <>{children}</>
}
