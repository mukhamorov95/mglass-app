import { NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'
import { getOwnerUser } from '@/lib/requireOwner'

type Category = 'glass' | 'mirror'

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// GET — returns all rows; sale rows only if owner
export async function GET() {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const isOwner = !!(await getOwnerUser())
  const supabase = db()

  const { data, error } = await supabase
    .from('glass_price_matrix')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).filter(r => r.price_type === 'cost' || isOwner)
  return NextResponse.json(rows)
}

// POST — upsert a single row OR action: 'clear_tab'
export async function POST(req: Request) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json() as {
    action?: 'clear_tab'
    name?: string
    price_type: 'cost' | 'sale'
    category?: Category
    t4?: number | null; t5?: number | null; t6?: number | null
    t8?: number | null; t10?: number | null; t12?: number | null
    waste_pct?: number | null
    sort_order?: number
  }

  const category: Category = body.category ?? 'glass'

  // Sale writes require owner
  if (body.price_type === 'sale') {
    const owner = await getOwnerUser()
    if (!owner) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = db()

  if (body.action === 'clear_tab') {
    const { error } = await supabase
      .from('glass_price_matrix')
      .update({ t4: null, t5: null, t6: null, t8: null, t10: null, t12: null, updated_at: new Date().toISOString() })
      .eq('price_type', body.price_type)
      .eq('category', category)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const { data, error } = await supabase
    .from('glass_price_matrix')
    .upsert({ ...body, category, updated_at: new Date().toISOString() }, { onConflict: 'name,price_type,category' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE — remove a glass/mirror name (both cost + sale rows for that category)
export async function DELETE(req: Request) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { name, category } = await req.json() as { name: string; category?: Category }
  const supabase = db()

  let q = supabase.from('glass_price_matrix').delete().eq('name', name)
  if (category) q = q.eq('category', category)

  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// PATCH — rename (updates both cost and sale rows for the same category, plus b2b_materials)
export async function PATCH(req: Request) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { oldName, newName, category } = await req.json() as { oldName: string; newName: string; category?: Category }
  const supabase = db()

  // Rename in glass_price_matrix (both cost + sale rows)
  let q = supabase
    .from('glass_price_matrix')
    .update({ name: newName, updated_at: new Date().toISOString() })
    .eq('name', oldName)
  if (category) q = q.eq('category', category)

  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mirror rename into b2b_materials so the calculator stays in sync
  await supabase
    .from('b2b_materials')
    .update({ name: newName })
    .eq('name', oldName)

  return NextResponse.json({ ok: true })
}
