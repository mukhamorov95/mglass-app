import { redirect } from 'next/navigation'
import { getRole, canAccessRoute } from '@/lib/getRole'
import InquiriesClient from './InquiriesClient'

// Входящие заявки B2B: Авито и другие каналы до того, как заявка стала клиентом
// (концепция docs/avito-b2b/CONCEPT.md). Общение — в чате Авито, здесь — учёт и скорость ответа.
export default async function InquiriesPage() {
  const role = await getRole()
  if (!canAccessRoute(role, '/b2b-crm/inquiries')) redirect('/access-denied')
  return <InquiriesClient />
}
