import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'

export async function POST(req: NextRequest) {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { entity_type, tax_system, fixed_costs, profit_split, avg_variable_pct, monthly_revenue_target } = body

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { error } = await supabase
    .from('cfo_settings')
    .upsert({
      id: 1,
      entity_type,
      tax_system,
      fixed_costs,
      profit_split,
      avg_variable_pct,
      monthly_revenue_target,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
