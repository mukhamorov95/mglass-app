import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { getRole } from '@/lib/getRole'
import { requireRole } from '@/lib/apiAuth'
import { suggestMappings } from '@/lib/glassPrice/applyPlan'
import type { MatrixCostRow, ParsedItem } from '@/lib/glassPrice/types'

// Привязки «строка справочника ← колонка прайса». Живут отдельно от версий:
// задал один раз — каждый следующий прайс поставщика применяется автоматически.

export async function GET(req: NextRequest) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const supplier = (req.nextUrl.searchParams.get('supplier') || 'aig').toLowerCase()
  const suggestFor = req.nextUrl.searchParams.get('suggest_from')   // id версии прайса

  const supa = createServiceClient()
  const [{ data: mappings }, { data: matrix }] = await Promise.all([
    supa.from('glass_price_mappings').select('*').eq('supplier', supplier).order('matrix_category').order('matrix_name').order('thickness'),
    supa.from('glass_price_matrix').select('name, category, price_type, t4, t5, t6, t8, t10, t12').eq('price_type', 'cost'),
  ])

  const costRows = (matrix ?? []) as MatrixCostRow[]
  let suggestions: ReturnType<typeof suggestMappings> = []
  if (suggestFor) {
    const { data: rawItems } = await supa.from('glass_price_list_items').select('*').eq('list_id', suggestFor)
    const items: ParsedItem[] = (rawItems ?? []).map(r => ({
      section: r.section, product: r.product, variantCode: r.variant_code,
      thicknessMm: r.thickness_mm == null ? null : Number(r.thickness_mm),
      sheetFormat: r.sheet_format, pricePerM2: r.price_per_m2 == null ? null : Number(r.price_per_m2),
      note: r.note, sortOrder: r.sort_order,
    }))
    suggestions = suggestMappings(items, costRows)
  }

  return NextResponse.json({ mappings: mappings ?? [], matrixRows: costRows, suggestions })
}

type InMapping = {
  matrix_name?: string; matrix_category?: string; thickness?: number
  section?: string; product?: string; coefficient?: number; rounding?: number; enabled?: boolean
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => null) as { supplier?: string; mappings?: InMapping[] } | null
  const supplier = (body?.supplier || 'aig').toLowerCase()
  const list = Array.isArray(body?.mappings) ? body!.mappings! : []
  if (list.length === 0) return NextResponse.json({ error: 'нет привязок' }, { status: 400 })
  if (list.length > 500) return NextResponse.json({ error: 'слишком много привязок за раз' }, { status: 400 })

  const rows = list
    .filter(m => m.matrix_name && m.product && (m.matrix_category === 'glass' || m.matrix_category === 'mirror'))
    .map(m => ({
      supplier,
      matrix_name: String(m.matrix_name).slice(0, 200),
      matrix_category: m.matrix_category as 'glass' | 'mirror',
      thickness: Number.isFinite(m.thickness) ? Number(m.thickness) : 0,
      section: (m.section ?? '').slice(0, 200),
      product: String(m.product).slice(0, 200),
      coefficient: Number.isFinite(m.coefficient) && Number(m.coefficient) > 0 ? Number(m.coefficient) : 1,
      rounding: Number.isFinite(m.rounding) && Number(m.rounding) > 0 ? Math.round(Number(m.rounding)) : 1,
      enabled: m.enabled !== false,
      updated_at: new Date().toISOString(),
    }))
  if (rows.length === 0) return NextResponse.json({ error: 'нечего сохранять' }, { status: 400 })

  const { error } = await createServiceClient()
    .from('glass_price_mappings')
    .upsert(rows, { onConflict: 'supplier,matrix_name,matrix_category,thickness' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, saved: rows.length })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'нужен id привязки' }, { status: 400 })

  const { error } = await createServiceClient().from('glass_price_mappings').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
