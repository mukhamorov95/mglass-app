import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data, error } = await supabase
    .from('materials')
    .select('id, name, category, unit, cost_price, stock_qty, min_stock_qty, active')
    .eq('active', true)
    .order('category')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id, stock_qty, min_stock_qty } = await req.json()
  if (!id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 })

  const client = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const update: Record<string, number> = {}
  if (stock_qty    !== undefined) update.stock_qty    = stock_qty
  if (min_stock_qty !== undefined) update.min_stock_qty = min_stock_qty

  const { error } = await client.from('materials').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
