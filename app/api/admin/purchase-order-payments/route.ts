import { NextRequest, NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const ALLOWED_ROLES = new Set(['admin', 'ceo', 'cfo', 'buyer'])

export async function GET(req: NextRequest) {
  const role = await getRole()
  if (!ALLOWED_ROLES.has(role ?? '')) {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const purchaseOrderId = searchParams.get('purchase_order_id')

  let query = db()
    .from('purchase_order_payments')
    .select('*')
    .order('payment_date', { ascending: true })
    .order('id', { ascending: true })

  if (purchaseOrderId) {
    query = query.eq('purchase_order_id', Number(purchaseOrderId))
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const role = await getRole()
  if (!ALLOWED_ROLES.has(role ?? '')) {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })
  }

  const body = await req.json()
  const { purchase_order_id, amount, payment_date, comment } = body

  if (!purchase_order_id || !amount || Number(amount) <= 0) {
    return NextResponse.json(
      { error: 'Нужен purchase_order_id и amount > 0' },
      { status: 400 },
    )
  }

  const { data, error } = await db()
    .from('purchase_order_payments')
    .insert({
      purchase_order_id: Number(purchase_order_id),
      amount:            Number(amount),
      payment_date:      payment_date || null,
      comment:           comment      || null,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, payment: data })
}
