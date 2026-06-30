import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/apiAuth'

function db() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard

  const { name, short_name, category, unit, cost_price } = await req.json()
  if (!name || !cost_price) return NextResponse.json({ error: 'name and cost_price required' }, { status: 400 })

  const { data, error } = await db()
    .from('materials')
    .insert({
      name,
      short_name: short_name ?? null,
      category:   category  ?? 'подсветка',
      unit:       unit      ?? 'шт',
      cost_price,
      active:     true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
