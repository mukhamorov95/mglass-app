import { getUserProfile, canAccessRoute } from '@/lib/getRole'
import { redirect } from 'next/navigation'

// Раздел пускает тех же, кого middleware пускает на /sales: владельцев, менеджеров,
// коммерческого и закупщика с кабинетом менеджера (Вера, решение владельца 05.10).
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const profile = await getUserProfile()
  const opts = { b2bScope: profile?.permissions.b2b_client_scope ?? null, managerWorkspace: profile?.permissions.manager_workspace === true }
  if (!profile || !canAccessRoute(profile.role, '/sales', opts)) redirect('/')
  return <>{children}</>
}
