import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const { data, error } = await adminClient().from('sales_bonuses').select('*').order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const body = await req.json()
  const { error, data } = await adminClient().from('sales_bonuses').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const { id, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
  const { error } = await adminClient().from('sales_bonuses').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
  const { error } = await adminClient().from('sales_bonuses').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
