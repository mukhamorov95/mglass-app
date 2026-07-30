import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'

// Развитие B2B — планирование канала производства. Владелец (admin/ceo) +
// коммерческий + seo (по словам владельца эти роли — он сам).
export default async function B2BGrowthLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || !['admin', 'ceo', 'commercial', 'seo'].includes(role)) redirect('/access-denied')
  return <>{children}</>
}
