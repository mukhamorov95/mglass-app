import { NextRequest, NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'

export const dynamic = 'force-dynamic'

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const WRITE_ROLES = new Set(['admin', 'ceo'])

export async function GET(req: NextRequest) {
  const role = await getRole()
  if (!role) return NextResponse.json({ ok: false, error: 'Не авторизован' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const materialId = searchParams.get('material_id')
  if (!materialId) {
    return NextResponse.json({ ok: false, error: 'Нужен material_id' }, { status: 400 })
  }

  const { data, error } = await db()
    .from('b2b_material_sheet_variants')
    .select('*')
    .eq('material_id', Number(materialId))
    .order('is_default', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, variants: data ?? [] })
}

export async function POST(req: NextRequest) {
  const role = await getRole()
  if (!WRITE_ROLES.has(role ?? '')) {
    return NextResponse.json({ ok: false, error: 'Недостаточно прав' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'Неверный запрос' }, { status: 400 })
  }

  const material_id = Number(body.material_id)
  const sheet_width = Number(body.sheet_width)
  const sheet_height = Number(body.sheet_height)

  if (!material_id || material_id <= 0) {
    return NextResponse.json({ ok: false, error: 'Нужен material_id > 0' }, { status: 400 })
  }
  if (!sheet_width || sheet_width <= 0 || !sheet_height || sheet_height <= 0) {
    return NextResponse.json({ ok: false, error: 'sheet_width и sheet_height должны быть > 0' }, { status: 400 })
  }

  const is_default = Boolean(body.is_default)

  if (is_default) {
    await db()
      .from('b2b_material_sheet_variants')
      .update({ is_default: false })
      .eq('material_id', material_id)
      .eq('active', true)
  }

  const { data, error } = await db()
    .from('b2b_material_sheet_variants')
    .insert({
      material_id,
      sheet_width,
      sheet_height,
      supplier_id:            body.supplier_id            ? String(body.supplier_id)            : null,
      supplier_material_name: body.supplier_material_name ? String(body.supplier_material_name) : null,
      is_default,
      active: true,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, variant: data })
}
