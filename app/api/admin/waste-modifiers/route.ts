import { NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const supabase = db()
  const { data, error } = await supabase
    .from('material_waste_modifiers')
    .select('*')
    .order('sort_order')
    .order('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const body = await req.json()
  const supabase = db()
  const { data, error } = await supabase
    .from('material_waste_modifiers')
    .upsert({ ...body, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: Request) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id, ...fields } = await req.json()
  const supabase = db()
  const { error } = await supabase
    .from('material_waste_modifiers')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await req.json()
  const supabase = db()
  const { error } = await supabase.from('material_waste_modifiers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
