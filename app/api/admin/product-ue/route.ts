import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

async function admin() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return null
  return s
}

export async function GET(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const sku_id = searchParams.get('sku_id')
  if (!sku_id) return NextResponse.json({ error: 'sku_id required' }, { status: 400 })
  const { data, error } = await s
    .from('product_unit_economics')
    .select('*')
    .eq('sku_id', parseInt(sku_id))
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { sku_id, ...fields } = await req.json()
  const { error } = await s
    .from('product_unit_economics')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('sku_id', sku_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { data, error } = await s
    .from('product_unit_economics')
    .upsert({ ...body, updated_at: new Date().toISOString() }, { onConflict: 'sku_id' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
