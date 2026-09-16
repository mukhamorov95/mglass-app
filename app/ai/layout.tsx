import { redirect } from 'next/navigation'
import { getRole, isOwnerRole } from '@/lib/getRole'

// Раздел AI — у владельца: отсюда правится то, что бот говорит клиентам сам.
export default async function AiLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!isOwnerRole(role)) redirect('/')
  return <>{children}</>
}
