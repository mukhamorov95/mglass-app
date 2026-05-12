import { NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { getOwnerUser } from '@/lib/requireOwner'

const VALID_MM = [4, 5, 6, 8, 10, 12]

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST — transfer sale prices from materials (category='стекло') → glass_price_matrix (price_type='sale')
// Parses name format: "Стекло <type> <N> мм" → type name + thickness column t<N>
export async function POST() {
  const owner = await getOwnerUser()
  if (!owner) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const supabase = db()

  const { data: glassMats, error: matErr } = await supabase
    .from('materials')
    .select('id, name, cost_price, sale_price')
    .eq('category', 'стекло')

  if (matErr) return NextResponse.json({ error: matErr.message }, { status: 500 })

  // Group: typeName → { mm: price }
  const grouped: Record<string, Record<number, number>> = {}

  for (const mat of glassMats ?? []) {
    const match = mat.name.match(/^Стекло\s+(.+?)\s+(\d+)\s*мм\s*$/i)
    if (!match) continue
    const typeName = match[1].trim()
    const mm = parseInt(match[2])
    if (!VALID_MM.includes(mm)) continue
    const price = mat.sale_price ?? mat.cost_price
    if (!grouped[typeName]) grouped[typeName] = {}
    grouped[typeName][mm] = price
  }

  if (Object.keys(grouped).length === 0) {
    return NextResponse.json({ ok: true, message: 'Нет материалов категории "стекло" с нужным форматом имени', transferred: 0 })
  }

  // Fetch existing cost rows to get canonical names and sort_order
  const { data: costRows } = await supabase
    .from('glass_price_matrix')
    .select('name, sort_order')
    .eq('price_type', 'cost')

  const nameMap = new Map<string, string>()
  const sortMap = new Map<string, number>()
  for (const row of costRows ?? []) {
    nameMap.set(row.name.toLowerCase(), row.name)
    sortMap.set(row.name, row.sort_order)
  }

  const results: { name: string; prices: Record<number, number>; error: string | null }[] = []
  let transferred = 0

  for (const [typeName, prices] of Object.entries(grouped)) {
    const canonicalName = nameMap.get(typeName.toLowerCase()) ?? typeName

    const saleRow: Record<string, unknown> = {
      name: canonicalName,
      price_type: 'sale',
      category: 'glass',
      sort_order: sortMap.get(canonicalName) ?? 99,
      updated_at: new Date().toISOString(),
    }

    for (const [mm, price] of Object.entries(prices)) {
      saleRow[`t${mm}`] = price
    }

    const { error } = await supabase
      .from('glass_price_matrix')
      .upsert(saleRow, { onConflict: 'name,price_type,category' })

    results.push({ name: canonicalName, prices, error: error?.message ?? null })
    if (!error) transferred++
  }

  return NextResponse.json({ ok: true, transferred, total: Object.keys(grouped).length, results })
}
