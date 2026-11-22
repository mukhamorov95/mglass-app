import { redirect } from 'next/navigation'
import { getRole, isOwnerRole } from '@/lib/getRole'
import { metrikaAuthorizeUrl } from '@/lib/marketing/metrikaToken'
import { MarketingTabs } from '../../MarketingTabs'
import { Connect } from './Connect'

export default async function MetrikaConnectPage() {
  const role = await getRole()
  if (!role) redirect('/login')
  if (!isOwnerRole(role)) redirect('/marketing/traffic')
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <MarketingTabs active="/marketing/traffic" sub="Подключение Яндекс.Метрики" />
      <Connect authorizeUrl={metrikaAuthorizeUrl()} />
    </div>
  )
}
