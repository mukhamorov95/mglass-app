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
  const role = await getRole()
  if (role !== 'admin') return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })

  const supabase = db()

  const { data: matrix, error: matErr } = await supabase
    .from('glass_price_matrix')
    .select('*')
    .order('name')

  if (matErr) return NextResponse.json({ error: matErr.message }, { status: 500 })

  const { data: existing, error: exErr } = await supabase
    .from('b2b_materials')
    .select('id, name, thickness, notes')

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })

  const lookup = new Map<string, { id: number; notes: string | null }>()
  for (const m of existing ?? []) {
    lookup.set(`${m.name}::${m.thickness}`, { id: m.id, notes: m.notes })
  }

  const toInsert: object[] = []
  const toUpdate: { id: number; cost_price: number; waste_percent: number; notes: string | null }[] = []

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

      const salePrice = (saleRow?.[field as keyof typeof saleRow] as number | null) ?? 0
      const existingEntry = lookup.get(`${name}::${t}`)

      if (existingEntry) {
        const notes = mergeNotes(existingEntry.notes, salePrice)
        toUpdate.push({ id: existingEntry.id, cost_price: costPrice, waste_percent: wastePct, notes })
      } else {
        toInsert.push({
          name,
          category: b2bCategory,
          thickness: t,
          cost_price: costPrice,
          vat_rate: 22,
          waste_percent: wastePct,
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
    const { error, data } = await supabase.from('b2b_materials').insert(toInsert).select('id')
    if (error) insertError = error.message
    else inserted = data?.length ?? toInsert.length
  }

  return NextResponse.json({ ok: !insertError, updated, inserted, total: updated + inserted, error: insertError })
}
