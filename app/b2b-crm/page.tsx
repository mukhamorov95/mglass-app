import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'
import B2BCRMClient from './CRMClient'

export default async function B2BCRMPage() {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo') {
    redirect('/access-denied')
  }
  return <B2BCRMClient />
}
