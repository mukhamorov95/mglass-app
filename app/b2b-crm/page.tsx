import { redirect } from 'next/navigation'
import { getRole, isOwnerRole } from '@/lib/getRole'
import B2BCRMClient from './CRMClient'

export default async function B2BCRMPage() {
  const role = await getRole()
  if (!isOwnerRole(role)) redirect('/access-denied')
  return <B2BCRMClient />
}
