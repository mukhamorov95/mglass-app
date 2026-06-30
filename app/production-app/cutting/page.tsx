import { redirect } from 'next/navigation'

// Резка теперь часть общего станция-экрана.
export default function CuttingRedirect() {
  redirect('/production-app/station/cutting')
}
