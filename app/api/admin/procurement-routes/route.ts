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

export async function GET(req: NextRequest) {
  const user = await auth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const routeId = searchParams.get('route_id')

  if (routeId) {
    const { data, error } = await service()
      .from('procurement_route_stops')
      .select('*')
      .eq('route_id', routeId)
      .order('position')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? [])
  }

  const { data, error } = await service()
    .from('procurement_routes')
    .select('*')
    .order('route_date', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const user = await auth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const body = await req.json()
  const table = body._type === 'stop' ? 'procurement_route_stops' : 'procurement_routes'
  const { _type, ...rest } = body
  const { data, error } = await service().from(table).insert(rest).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const user = await auth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const { _type, id, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 })
  const table = _type === 'stop' ? 'procurement_route_stops' : 'procurement_routes'
  const { error } = await service().from(table).update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await auth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const { _type, id } = await req.json()
  const table = _type === 'stop' ? 'procurement_route_stops' : 'procurement_routes'
  const { error } = await service().from(table).delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
