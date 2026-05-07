import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const url   = new URL(req.url)
  const from  = url.searchParams.get('from')
  const to    = url.searchParams.get('to')

  let query = supabase
    .from('appointments')
    .select('*, orders(number, client_name)')
    .order('scheduled_at', { ascending: true })

  if (from) query = query.gte('scheduled_at', from)
  if (to)   query = query.lte('scheduled_at', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const body = await req.json()
  const { type, scheduled_at, address, assignee_name, notes, order_id } = body

  if (!type || !scheduled_at) {
    return NextResponse.json({ error: 'Нужны type и scheduled_at' }, { status: 400 })
  }

  const client = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await client.from('appointments').insert({
    type,
    scheduled_at,
    address: address?.trim() || null,
    assignee_name: assignee_name?.trim() || null,
    notes: notes?.trim() || null,
    order_id: order_id || null,
    created_by: user.id,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 })

  const client = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { error } = await client.from('appointments').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
