import { NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'
import { requireOwner } from '@/lib/apiAuth'

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const supabase = db()
  const { data, error } = await supabase
    .from('pricing_formula')
    .select('*')
    .order('section')
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH: update a single param value by id
export async function PATCH(req: Request) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const { id, value } = await req.json() as { id: number; value: number }
  const supabase = db()
  const { error } = await supabase
    .from('pricing_formula')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
