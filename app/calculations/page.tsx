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
  const { data: settingsData } = await supabase.from('financial_settings').select('*')
  allSettings = (settingsData ?? []) as FinancialSettings[]

  if (isAdmin) {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data } = await admin.from('users').select('id,name,email')
    if (data) {
      usersMap = Object.fromEntries(data.map(u => [u.id, u.name ?? u.email]))
    }
  }

  return <CalculationsClient isAdmin={isAdmin} usersMap={usersMap} allSettings={allSettings} />
}
