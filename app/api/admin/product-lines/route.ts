import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

async function admin() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return null
  return s
}

export async function GET() {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await s
    .from('product_lines')
    .select('*')
    .order('sort_order')
    .order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { data, error } = await s.from('product_lines').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, ...fields } = await req.json()
  const { error } = await s.from('product_lines').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  const { error } = await s.from('product_lines').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
