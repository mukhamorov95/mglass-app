import { NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const THICKNESSES = [4, 5, 6, 8, 10, 12] as const

function guessB2BCategory(name: string, matCategory: 'glass' | 'mirror'): string {
  if (matCategory === 'mirror') return 'зеркало'
  const n = name.toLowerCase()
  if (n.includes('тонир')) return 'тонированное'
  if (n.includes('сатин')) return 'сатин'
  if (n.includes('рифл') || n.includes('шиншилл') || n.includes('аквалайт') || n.includes('moru') || n.includes('мору')) return 'рифленое'
  return 'стекло'
}

const WASTE_DEFAULTS: Record<string, number> = {
  стекло: 15, зеркало: 18, тонированное: 20, сатин: 22, рифленое: 30, декоративное: 25,
}

// Категории листовых материалов, которыми управляет справочник «Стекло».
// Только их синк смеет деактивировать — фурнитуру и прочее не трогаем.
const SHEET_CATEGORIES = new Set(Object.keys(WASTE_DEFAULTS))

function buildNotes(salePrice: number): string | null {
  if (salePrice > 0) return JSON.stringify({ sale_price: salePrice })
  return null
}

function mergeNotes(existing: string | null, salePrice: number): string | null {
  let base: Record<string, unknown> = {}
  try { if (existing) base = JSON.parse(existing) } catch {}
  if (salePrice > 0) base.sale_price = salePrice
  else delete base.sale_price
  // Never touch passthrough here — admin controls it manually in /admin/b2b-materials
  return Object.keys(base).length > 0 ? JSON.stringify(base) : null
}

export async function POST() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const supabase = db()

  const { data: matrix, error: matErr } = await supabase
    .from('glass_price_matrix')
    .select('*')
    .order('name')

  if (matErr) return NextResponse.json({ error: matErr.message }, { status: 500 })

  const { data: existing, error: exErr } = await supabase
    .from('b2b_materials')
    .select('id, name, category, thickness, notes, active')

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })

  // Ключ обязан включать категорию: одно имя живёт в матрице и как стекло,
  // и как зеркало («Тонированное (бронза/графит)») — без категории строки коллидируют
  const lookup = new Map<string, { id: number; notes: string | null }>()
  for (const m of existing ?? []) {
    lookup.set(`${m.name}::${m.category}::${m.thickness}`, { id: m.id, notes: m.notes })
  }

  const toInsert: object[] = []
  const toUpdate: { id: number; category: string; cost_price: number; waste_percent: number; notes: string | null; active: boolean }[] = []
  const validKeys = new Set<string>()

  const keys = [...new Set((matrix ?? []).map(r => `${r.name}::${r.category}`))]

  for (const key of keys) {
    const [name, matCategory] = key.split('::')
    const costRow = (matrix ?? []).find(r => r.name === name && r.category === matCategory && r.price_type === 'cost')
    const saleRow = (matrix ?? []).find(r => r.name === name && r.category === matCategory && r.price_type === 'sale')
    if (!costRow) continue

    const b2bCategory = guessB2BCategory(name, matCategory as 'glass' | 'mirror')
    // Waste always comes from glass_price_matrix — source of truth
    const wastePct = costRow.waste_pct ?? WASTE_DEFAULTS[b2bCategory] ?? 15

    for (const t of THICKNESSES) {
      const field = `t${t}` as keyof typeof costRow
      const costPrice = costRow[field] as number | null
      if (!costPrice) continue

      validKeys.add(`${name}::${b2bCategory}::${t}`)
      const salePrice = (saleRow?.[field as keyof typeof saleRow] as number | null) ?? 0
      const existingEntry = lookup.get(`${name}::${b2bCategory}::${t}`)

      if (existingEntry) {
        const notes = mergeNotes(existingEntry.notes, salePrice)
        toUpdate.push({ id: existingEntry.id, category: b2bCategory, cost_price: costPrice, waste_percent: wastePct, notes, active: true })
      } else {
        toInsert.push({
          name,
          category: b2bCategory,
          thickness: t,
          cost_price: costPrice,
          vat_rate: 22,
          waste_percent: wastePct,
          supplier_id: costRow.supplier_id ?? null,
          supplier_material_name: costRow.supplier_material_name ?? null,
          active: true,
          notes: buildNotes(salePrice),
        })
      }
    }
  }

  let updated = 0
  for (const row of toUpdate) {
    const { id, ...fields } = row
    const { error } = await supabase.from('b2b_materials').update(fields).eq('id', id)
    if (!error) updated++
  }

  let inserted = 0
  let insertError: string | null = null
  if (toInsert.length > 0) {
    const { error, data } = await supabase
      .from('b2b_materials')
      .insert(toInsert)
      .select('id, supplier_id, supplier_material_name')
    if (error) {
      insertError = error.message
    } else {
      inserted = data?.length ?? toInsert.length
      if (data && data.length > 0) {
        const newVariants = (data as { id: number; supplier_id: string | null; supplier_material_name: string | null }[]).map(mat => ({
          material_id: mat.id,
          sheet_width: 3210,
          sheet_height: 2250,
          supplier_id: mat.supplier_id ?? null,
          supplier_material_name: mat.supplier_material_name ?? null,
          is_default: true,
          active: true,
        }))
        await supabase.from('b2b_material_sheet_variants').insert(newVariants)
      }
    }
  }

  // Деактивация призраков: активный листовой материал, у которого в справочнике
  // больше нет цены на эту толщину, гаснет (не удаляется — на id ссылаются заказы)
  let deactivated = 0
  const ghosts = (existing ?? []).filter(m =>
    m.active && SHEET_CATEGORIES.has(m.category) && !validKeys.has(`${m.name}::${m.category}::${m.thickness}`)
  )
  for (const g of ghosts) {
    const { error } = await supabase.from('b2b_materials').update({ active: false }).eq('id', g.id)
    if (!error) deactivated++
  }

  return NextResponse.json({ ok: !insertError, updated, inserted, deactivated, total: updated + inserted, error: insertError })
}
