import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'

// Раздел видит только владелец: тут баланс платного сервиса, расходы и порядок
// производства контента — сотрудникам это не нужно и не полезно.
export default async function PromoLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || !['admin', 'ceo'].includes(role)) redirect('/')
  return <>{children}</>
}
