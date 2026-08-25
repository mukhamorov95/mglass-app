import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { getRole } from '@/lib/getRole'
import { requireRole } from '@/lib/apiAuth'
import { buildApplyPlan, thicknessField } from '@/lib/glassPrice/applyPlan'
import type { ApplyPlan, Mapping, MatrixCostRow, ParsedItem } from '@/lib/glassPrice/types'

type MatrixRow = MatrixCostRow & { price_type: 'cost' | 'sale' }

async function loadContext(listId: string) {
  const supa = createServiceClient()
  const [{ data: list }, { data: rawItems }, { data: mappings }, { data: matrix }] = await Promise.all([
    supa.from('glass_price_lists').select('*').eq('id', listId).maybeSingle(),
    supa.from('glass_price_list_items').select('*').eq('list_id', listId).order('sort_order'),
    supa.from('glass_price_mappings').select('*'),
    supa.from('glass_price_matrix').select('name, category, price_type, t4, t5, t6, t8, t10, t12'),
  ])

  const items: ParsedItem[] = (rawItems ?? []).map(r => ({
    section: r.section, product: r.product, variantCode: r.variant_code,
    thicknessMm: r.thickness_mm == null ? null : Number(r.thickness_mm),
    sheetFormat: r.sheet_format, pricePerM2: r.price_per_m2 == null ? null : Number(r.price_per_m2),
    note: r.note, sortOrder: r.sort_order,
  }))

  const rows = (matrix ?? []) as MatrixRow[]
  const costRows: MatrixCostRow[] = rows.filter(r => r.price_type === 'cost')
  const saleRows: MatrixCostRow[] = rows.filter(r => r.price_type === 'sale')

  const rules: Mapping[] = (mappings ?? [])
    .filter(m => m.supplier === (list?.supplier ?? 'aig'))
    .map(m => ({
      matrix_name: m.matrix_name, matrix_category: m.matrix_category, thickness: m.thickness,
      section: m.section, product: m.product, coefficient: Number(m.coefficient),
      rounding: Number(m.rounding), enabled: m.enabled,
    }))

  return { supa, list, items, rules, costRows, saleRows }
}

// Маржа считается только справочно — продажные цены прайс не трогает.
function withSale(plan: ApplyPlan, saleRows: MatrixCostRow[]) {
  const sale = new Map(saleRows.map(r => [`${r.name}|${r.category}`, r]))
  return plan.changes.map(c => {
    const row = sale.get(`${c.matrix_name}|${c.matrix_category}`)
    const salePrice = row ? (row[thicknessField(c.thickness)] as number | null) : null
    const marginBefore = salePrice && c.old_value ? (salePrice - c.old_value) / salePrice : null
    const marginAfter = salePrice ? (salePrice - c.new_value) / salePrice : null
    return { ...c, sale_price: salePrice, margin_before: marginBefore, margin_after: marginAfter }
  })
}

// GET — превью: что именно изменится в себестоимости, если применить эту версию.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params

  const { list, items, rules, costRows, saleRows } = await loadContext(id)
  if (!list) return NextResponse.json({ error: 'версия прайса не найдена' }, { status: 404 })

  const plan = buildApplyPlan(items, rules, costRows)
  return NextResponse.json({ ...plan, changes: withSale(plan, saleRows), list })
}

// POST — применить: пишем ТОЛЬКО cost-ячейки с привязкой, каждую фиксируем в журнале.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const { id } = await params

  const { supa, list, items, rules, costRows } = await loadContext(id)
  if (!list) return NextResponse.json({ error: 'версия прайса не найдена' }, { status: 404 })

  const plan = buildApplyPlan(items, rules, costRows)
  if (plan.changes.length === 0) {
    await supa.from('glass_price_lists').update({ status: 'applied', applied_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true, applied: 0, unchanged: plan.unchanged, needs_sync: false })
  }

  const server = await createServerClient()
  const { data: { user } } = await server.auth.getUser()

  // одна строка матрицы = один UPDATE со всеми её толщинами
  const byRow = new Map<string, Record<string, number>>()
  for (const c of plan.changes) {
    const key = `${c.matrix_name}|${c.matrix_category}`
    if (!byRow.has(key)) byRow.set(key, {})
    byRow.get(key)![thicknessField(c.thickness) as string] = c.new_value
  }

  const failed: string[] = []
  const done = new Set<string>()
  for (const [key, patch] of byRow) {
    const [name, category] = key.split('|')
    const { error } = await supa
      .from('glass_price_matrix')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('name', name).eq('category', category).eq('price_type', 'cost')
    if (error) failed.push(`${name} (${category}): ${error.message}`)
    else done.add(key)
  }

  const applied = plan.changes.filter(c => done.has(`${c.matrix_name}|${c.matrix_category}`))
  if (applied.length) {
    await supa.from('glass_price_apply_log').insert(applied.map(c => ({
      list_id: id,
      matrix_name: c.matrix_name, matrix_category: c.matrix_category, thickness: c.thickness,
      old_value: c.old_value, new_value: c.new_value,
      section: c.section, product: c.product, coefficient: c.coefficient,
      applied_by: user?.id ?? null,
    })))
  }

  await supa.from('glass_price_lists')
    .update({ status: 'applied', applied_at: new Date().toISOString(), applied_by: user?.id ?? null })
    .eq('id', id)

  // Предыдущие версии этого поставщика уходят в архив — актуальная всегда одна.
  await supa.from('glass_price_lists')
    .update({ status: 'archived' })
    .eq('supplier', list.supplier).eq('status', 'applied').neq('id', id)

  return NextResponse.json({
    ok: failed.length === 0,
    applied: applied.length,
    unchanged: plan.unchanged,
    failed,
    needs_sync: applied.length > 0,
  })
}
