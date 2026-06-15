import { NextRequest, NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'

export const dynamic = 'force-dynamic'

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const WRITE_ROLES = new Set(['admin', 'ceo'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const role = await getRole()
  if (!WRITE_ROLES.has(role ?? '')) {
    return NextResponse.json({ ok: false, error: 'Недостаточно прав' }, { status: 403 })
  }

  const { id } = await params
  const variantId = Number(id)
  if (!variantId || variantId <= 0) {
    return NextResponse.json({ ok: false, error: 'Неверный id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'Неверный запрос' }, { status: 400 })
  }

  // Fetch current variant to know material_id for default-reset logic
  const { data: current, error: fetchErr } = await db()
    .from('b2b_material_sheet_variants')
    .select('id, material_id, is_default, active')
    .eq('id', variantId)
    .single()

  if (fetchErr || !current) {
    return NextResponse.json({ ok: false, error: 'Вариант не найден' }, { status: 404 })
  }

  const update: Record<string, unknown> = {}
  if (body.sheet_width            !== undefined) update.sheet_width            = Number(body.sheet_width)
  if (body.sheet_height           !== undefined) update.sheet_height           = Number(body.sheet_height)
  if (body.supplier_id            !== undefined) update.supplier_id            = body.supplier_id            ? String(body.supplier_id)            : null
  if (body.supplier_material_name !== undefined) update.supplier_material_name = body.supplier_material_name ? String(body.supplier_material_name) : null
  if (body.active                 !== undefined) update.active                 = Boolean(body.active)
  if (body.is_default             !== undefined) update.is_default             = Boolean(body.is_default)

  // When setting this variant as default — reset others first
  if (update.is_default === true) {
    await db()
      .from('b2b_material_sheet_variants')
      .update({ is_default: false })
      .eq('material_id', current.material_id)
      .eq('active', true)
  }

  // When hiding the current default — strip default flag too
  if (update.active === false && current.is_default) {
    update.is_default = false
  }

  const { data, error } = await db()
    .from('b2b_material_sheet_variants')
    .update(update)
    .eq('id', variantId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, variant: data })
}

// Soft delete — delegates to PATCH { active: false }
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const role = await getRole()
  if (!WRITE_ROLES.has(role ?? '')) {
    return NextResponse.json({ ok: false, error: 'Недостаточно прав' }, { status: 403 })
  }

  const { id } = await params
  const variantId = Number(id)
  if (!variantId || variantId <= 0) {
    return NextResponse.json({ ok: false, error: 'Неверный id' }, { status: 400 })
  }

  const { data: current } = await db()
    .from('b2b_material_sheet_variants')
    .select('id, material_id, is_default')
    .eq('id', variantId)
    .single()

  if (!current) return NextResponse.json({ ok: false, error: 'Вариант не найден' }, { status: 404 })

  const update: Record<string, unknown> = { active: false }
  if (current.is_default) update.is_default = false

  const { data, error } = await db()
    .from('b2b_material_sheet_variants')
    .update(update)
    .eq('id', variantId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, variant: data })
}
