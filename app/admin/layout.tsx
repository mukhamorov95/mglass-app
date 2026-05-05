import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (role !== 'admin') redirect('/')
  return <>{children}</>
}
