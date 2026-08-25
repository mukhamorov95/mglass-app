import { getRole } from '@/lib/getRole'
import { INVENTORY_WRITE_ROLES } from '@/lib/inventory/auth'
import InventoryClient from './InventoryClient'

export const dynamic = 'force-dynamic'

export default async function InventoryPage() {
  const role = await getRole()
  return <InventoryClient canWrite={!!role && INVENTORY_WRITE_ROLES.includes(role)} />
}
