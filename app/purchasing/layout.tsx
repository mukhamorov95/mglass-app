import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'

// Кабинет закупщика: материал под заказы. Видят закупщик и владелец.
export default async function PurchasingLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || !['admin', 'ceo', 'buyer'].includes(role)) redirect('/')
  return <>{children}</>
}
