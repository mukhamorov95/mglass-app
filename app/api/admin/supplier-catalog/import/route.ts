import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Импорт прайса поставщика: браузер парсит xlsx и шлёт разобранные строки батчами
// (файл 20+ МБ не влезает в лимит тела Vercel ~4.5 МБ). Себестоимость считается
// на сервере из скидки поставщика. reset=true на первом батче — заменить весь прайс.
// Доступ — владелец + логист-закупщик (buyer).

type InRow = { category?: string; article?: string; name?: string; color?: string; unit?: string; retail_price?: number; url?: string }

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => null) as {
    supplier?: string; title?: string; discount_percent?: number; site_url?: string
    rows?: InRow[]; reset?: boolean; source_file?: string
  } | null
  const supplier = (body?.supplier || '').trim().toLowerCase()
  if (!supplier || !Array.isArray(body?.rows)) {
    return NextResponse.json({ error: 'supplier + rows обязательны' }, { status: 400 })
  }
  if (body.rows.length > 2000) return NextResponse.json({ error: 'батч > 2000 строк' }, { status: 400 })

  const supa = createServiceClient()

  // Поставщик: создать/обновить (title/скидка/сайт), затем взять актуальную скидку.
  if (body.title || typeof body.discount_percent === 'number' || body.site_url) {
    const patch: Record<string, unknown> = { supplier, updated_at: new Date().toISOString() }
    if (body.title) patch.title = body.title
    if (typeof body.discount_percent === 'number') patch.discount_percent = Math.max(0, Math.min(100, body.discount_percent))
    if (body.site_url) patch.site_url = body.site_url
    await supa.from('supplier_price_sources').upsert(patch, { onConflict: 'supplier' })
  }
  const { data: src } = await supa.from('supplier_price_sources').select('discount_percent').eq('supplier', supplier).maybeSingle()
  if (!src) return NextResponse.json({ error: 'поставщик не найден — задай название и скидку' }, { status: 400 })
  const disc = Number(src.discount_percent) || 0

  if (body.reset) {
    const { error } = await supa.from('supplier_price_rows').delete().eq('supplier', supplier)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = new Date().toISOString()
  const seen = new Set<string>()
  const rows = body.rows
    .filter(r => (r.name || r.article) && typeof r.retail_price === 'number' && r.retail_price >= 0)
    .map(r => {
      const article = (r.article || r.name || '').slice(0, 300)
      const color = (r.color || '').slice(0, 120)
      return {
        supplier,
        category: (r.category || '').slice(0, 200),
        article,
        name: (r.name || r.article || '').slice(0, 500),
        color,
        unit: (r.unit || 'шт').slice(0, 40),
        retail_price: Math.round(r.retail_price!),
        discount_percent: disc,
        cost_price: Math.round(r.retail_price! * (1 - disc / 100)),
        url: (r.url || '').slice(0, 500),
        active: true,
        source_file: (body.source_file || '').slice(0, 200),
        updated_at: now,
      }
    })
    .filter(r => { const k = `${r.article}|${r.color}`; if (seen.has(k)) return false; seen.add(k); return true })

  if (rows.length === 0) return NextResponse.json({ ok: true, inserted: 0 })
  const { error } = await supa.from('supplier_price_rows').upsert(rows, { onConflict: 'supplier,article,color' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, inserted: rows.length })
}
