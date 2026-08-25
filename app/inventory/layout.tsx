import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import { INVENTORY_READ_ROLES } from '@/lib/inventory/auth'

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || !INVENTORY_READ_ROLES.includes(role)) redirect('/')
  return <>{children}</>
}
