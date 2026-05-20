import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as svc } from '@supabase/supabase-js'

function service() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function auth() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET() {
  const user = await auth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const { data, error } = await service()
    .from('purchase_orders')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const user = await auth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const body = await req.json()
  const { data, error } = await service().from('purchase_orders').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const user = await auth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const { id, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 })
  fields.updated_at = new Date().toISOString()
  const { error } = await service().from('purchase_orders').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await auth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 })
  const { error } = await service().from('purchase_orders').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
