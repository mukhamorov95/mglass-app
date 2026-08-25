import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'
import TodayClient from './TodayClient'

// А15: «мой день по B2B». У B2C такой экран есть (/manager, зоны AmoCRM),
// у B2B менеджер до сих пор ходил по трём спискам и держал приоритеты в голове.

const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'buyer']

export default async function B2BTodayPage() {
  const role = await getRole()
  if (!role || !ALLOWED.includes(role)) redirect('/access-denied')
  return <TodayClient />
}
