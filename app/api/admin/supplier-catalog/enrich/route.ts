import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { fetchProductInfo } from '@/lib/supplier/enrich'

// Подтягивает с сайта поставщика ссылку, фото и характеристики позиции.
// Ходим последовательно и небольшими пачками: это чужой сайт, а не наш API.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => null) as { ids?: number[] } | null
  const ids = (body?.ids ?? []).filter(n => Number.isInteger(n)).slice(0, 20)
  if (ids.length === 0) return NextResponse.json({ error: 'ids обязательны' }, { status: 400 })

  const supa = createServiceClient()
  const { data: rows } = await supa.from('supplier_price_rows')
    .select('id,supplier,article,name,url').in('id', ids)

  const out: { id: number; url: string; imageUrl: string; specs: Record<string, string> }[] = []
  for (const row of rows ?? []) {
    const info = await fetchProductInfo(row)
    if (!info) continue
    await supa.from('supplier_price_rows').update({
      url: info.url, image_url: info.imageUrl, specs: info.specs, enriched_at: new Date().toISOString(),
    }).eq('id', row.id)
    out.push({ id: row.id, ...info })
  }
  return NextResponse.json({ enriched: out.length, rows: out, skipped: (rows?.length ?? 0) - out.length })
}
