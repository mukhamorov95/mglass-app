import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'
import InvoicesClient from './InvoicesClient'

// А10: реестр счетов у менеджера. Тот же реестр invoices, что у финконтура,
// но выборка режется по клиентам менеджера в /api/invoices.

const ALLOWED = ['admin', 'ceo', 'cfo', 'accountant', 'commercial', 'manager']

export default async function B2BInvoicesPage() {
  const role = await getRole()
  if (!role || !ALLOWED.includes(role)) redirect('/access-denied')
  return <InvoicesClient />
}
