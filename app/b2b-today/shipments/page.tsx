import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'
import ShipmentsClient from './ShipmentsClient'

// Разбор отгрузок без отметки (решение владельца 30.09, docs/MANAGER_UX_ROUTE.md, У3).
const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'buyer']

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const role = await getRole()
  if (!role || !ALLOWED.includes(role)) redirect('/access-denied')
  const { order } = await searchParams
  const focusId = Number(order) || null
  return <ShipmentsClient focusId={focusId} />
}
