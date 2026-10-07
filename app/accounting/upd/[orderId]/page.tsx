import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'
import { UPD_ACCOUNTING_ROLES } from '@/lib/b2b/updRegistry'
import UpdOrderClient from './UpdOrderClient'

export default async function AccountingIssuedUpdPage({ params }: { params: Promise<{ orderId: string }> }) {
  const role = await getRole()
  if (!role || !UPD_ACCOUNTING_ROLES.includes(role)) redirect('/accounting')
  const { orderId } = await params
  return <UpdOrderClient orderId={orderId} />
}
