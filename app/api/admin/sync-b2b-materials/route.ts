import { NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'

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

// Size-limited sheets (specific size in name) → passthrough = true, waste fixed at 10%
function isPassthrough(name: string): boolean {
  return /\d{3,4}[x×х]\d{3,4}/i.test(name)
}

export async function POST() {
  const role = await getRole()
  if (role !== 'admin') return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })

  const supabase = db()

  // 1. Load glass_price_matrix (all rows)
  const { data: matrix, error: matErr } = await supabase
    .from('glass_price_matrix')
    .select('*')
    .order('name')

  if (matErr) return NextResponse.json({ error: matErr.message }, { status: 500 })

  // 2. Load existing b2b_materials
  const { data: existing, error: exErr } = await supabase
    .from('b2b_materials')
    .select('id, name, thickness')

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })

  // Build lookup: "name::thickness" → id
  const lookup = new Map<string, number>()
  for (const m of existing ?? []) {
    lookup.set(`${m.name}::${m.thickness}`, m.id)
  }

  const toInsert: object[] = []
  const toUpdate: { id: number; cost_price: number; sale_price: number; waste_percent: number }[] = []

  // Group matrix rows by (name, category)
  const names = [...new Set((matrix ?? []).map(r => `${r.name}::${r.category}`))]

  for (const key of names) {
    const [name, matCategory] = key.split('::')
    const costRow = (matrix ?? []).find(r => r.name === name && r.category === matCategory && r.price_type === 'cost')
    const saleRow = (matrix ?? []).find(r => r.name === name && r.category === matCategory && r.price_type === 'sale')

    if (!costRow) continue

    const b2bCategory = guessB2BCategory(name, matCategory as 'glass' | 'mirror')
    const passthrough = isPassthrough(name)

    for (const t of THICKNESSES) {
      const field = `t${t}` as keyof typeof costRow
      const costPrice = costRow[field] as number | null
      if (!costPrice) continue

      const salePrice = (saleRow?.[field as keyof typeof saleRow] as number | null) ?? 0
      const wastePct = passthrough ? 10 : (costRow.waste_pct ?? WASTE_DEFAULTS[b2bCategory] ?? 15)

      const existingId = lookup.get(`${name}::${t}`)
      if (existingId) {
        toUpdate.push({ id: existingId, cost_price: costPrice, sale_price: salePrice, waste_percent: wastePct })
      } else {
        toInsert.push({
          name,
          category: b2bCategory,
          thickness: t,
          cost_price: costPrice,
          sale_price: salePrice,
          vat_rate: 20,
          waste_percent: wastePct,
          active: true,
          passthrough,
          notes: null,
        })
      }
    }
  }

  // 3. Apply updates in batches
  let updated = 0
  for (const row of toUpdate) {
    const { id, ...fields } = row
    const { error } = await supabase.from('b2b_materials').update(fields).eq('id', id)
    if (!error) updated++
  }

  // 4. Insert new
  let inserted = 0
  if (toInsert.length > 0) {
    const { error } = await supabase.from('b2b_materials').insert(toInsert)
    if (!error) inserted = toInsert.length
  }

  return NextResponse.json({ ok: true, updated, inserted, total: updated + inserted })
}
