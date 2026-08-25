import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Сравнение поставщиков: по выбранной позиции ищем похожие у всех поставщиков
// (по значимым словам названия) и возвращаем отсортированный по себестоимости
// список — чтобы логист видел, у кого та же фурнитура дешевле.

// Значимые токены названия: слова ≥3 букв и размеры вида «30х10», числа.
function tokens(name: string): string[] {
  const norm = name.toLowerCase().replace(/ё/g, 'е').replace(/[×хx]/g, 'х')
  const raw = norm.match(/[а-яa-z]{3,}|\d+(?:[.,]\d+)?(?:х\d+)*/gi) ?? []
  const stop = new Set(['для', 'под', 'все', 'шт', 'мм', 'см', 'фурнитура'])
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of raw) {
    if (stop.has(t) || seen.has(t)) continue
    seen.add(t); out.push(t)
    if (out.length >= 3) break   // 3 самых первых значимых слова
  }
  return out
}

export const isDefect = (name: string) => /дефект|-def\b|уценк/i.test(name)

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  const supa = createServiceClient()
  const { data: row } = await supa.from('supplier_price_rows')
    .select('id,supplier,name,color,cost_price').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'не найдено' }, { status: 404 })

  const toks = tokens(row.name)
  let query = supa.from('supplier_price_rows')
    .select('id,supplier,name,color,cost_price,url')
  for (const t of toks) query = query.ilike('name', `%${t}%`)   // AND по словам
  const { data: matches } = await query.limit(40)

  // Брак («с дефектом», -DEF) в прайсе стоит копейки и всегда всплывает первым —
  // в подбор он попасть не должен: это не та же позиция, а уценка.
  const list = (matches ?? [])
    .filter(m => m.cost_price > 0 && !isDefect(m.name))
    .sort((a, b) => a.cost_price - b.cost_price)
    .slice(0, 12)
  const cheapest = list.length ? list[0].cost_price : null

  return NextResponse.json({
    base: { id: row.id, supplier: row.supplier, name: row.name, cost_price: row.cost_price },
    tokens: toks,
    cheapest,
    matches: list,
  })
}
