import { getRole } from '@/lib/getRole'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase-server'
import CalculationsClient from './CalculationsClient'
import type { FinancialSettings } from '@/lib/types'

export default async function CalculationsPage() {
  const role = await getRole()
  const isAdmin = role === 'admin'

  let usersMap: Record<string, string> = {}
  let allSettings: FinancialSettings[] = []

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? null

  const { data: settingsData } = await supabase.from('financial_settings').select('*')
  allSettings = (settingsData ?? []) as FinancialSettings[]

  // «Видит все сделки»: владелец (admin/ceo) или менеджер с can_view_all_deals.
  // Раньше все КП видел только admin — галка can_view_all_deals не применялась.
  let canViewAll = isAdmin || role === 'ceo'
  if (!canViewAll && userId) {
    const { data: profile } = await supabase.from('users').select('can_view_all_deals').eq('id', userId).maybeSingle()
    canViewAll = profile?.can_view_all_deals === true
  }

  if (canViewAll) {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data } = await admin.from('users').select('id,name,email')
    if (data) {
      usersMap = Object.fromEntries(data.map(u => [u.id, u.name ?? u.email]))
    }
  }

  return <CalculationsClient isAdmin={isAdmin} canViewAll={canViewAll} usersMap={usersMap} allSettings={allSettings} userId={userId} />
}
