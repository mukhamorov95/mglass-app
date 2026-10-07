import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'
import { UPD_ACCOUNTING_ROLES } from '@/lib/b2b/updRegistry'
import UpdRegistryClient from './UpdRegistryClient'

// Раздел бухгалтерии, но не для закупщика: layout бухгалтерии пускает его ради заявок на оплату.
export default async function AccountingUpdPage() {
  const role = await getRole()
  if (!role || !UPD_ACCOUNTING_ROLES.includes(role)) redirect('/accounting')
  return <UpdRegistryClient />
}
