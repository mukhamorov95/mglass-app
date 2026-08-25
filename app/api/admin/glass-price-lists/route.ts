import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { getRole } from '@/lib/getRole'
import { requireRole } from '@/lib/apiAuth'
import type { ParsedItem } from '@/lib/glassPrice/types'

// Версии прайса поставщика стекла. Загруженный файл лежит в Storage навсегда:
// старую версию можно открыть и посмотреть, какая цена была на ту дату.

export const PRICE_BUCKET = 'b2b-attachments'
const MAX_FILE = 12 * 1024 * 1024

export async function GET() {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const supa = createServiceClient()
  const { data, error } = await supa
    .from('glass_price_lists')
    .select('*')
    .order('price_date', { ascending: false })
    .order('uploaded_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (data ?? []).map(l => l.id)
  const counts: Record<string, number> = {}
  const applied: Record<string, number> = {}
  if (ids.length) {
    const { data: items } = await supa.from('glass_price_list_items').select('list_id').in('list_id', ids)
    for (const it of items ?? []) counts[it.list_id] = (counts[it.list_id] ?? 0) + 1
    const { data: log } = await supa.from('glass_price_apply_log').select('list_id').in('list_id', ids)
    for (const it of log ?? []) applied[it.list_id] = (applied[it.list_id] ?? 0) + 1
  }

  return NextResponse.json((data ?? []).map(l => ({ ...l, items_count: counts[l.id] ?? 0, applied_cells: applied[l.id] ?? 0 })))
}

// POST — новая версия прайса: файл + разобранные на клиенте строки.
export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'ожидается multipart/form-data' }, { status: 400 })

  const file = form.get('file')
  const priceDate = String(form.get('price_date') ?? '').trim()
  const supplier = (String(form.get('supplier') ?? 'aig').trim() || 'aig').toLowerCase()
  const title = String(form.get('title') ?? '').trim()
  const notes = String(form.get('notes') ?? '').trim()
  const vat = Number(form.get('vat_percent') ?? 22)
  const supplierId = String(form.get('supplier_id') ?? '').trim() || null

  if (!/^\d{4}-\d{2}-\d{2}$/.test(priceDate)) return NextResponse.json({ error: 'нужна дата прайса' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'нужен файл прайса' }, { status: 400 })
  if (file.size > MAX_FILE) return NextResponse.json({ error: 'файл больше 12 МБ' }, { status: 400 })

  let items: ParsedItem[] = []
  try { items = JSON.parse(String(form.get('items') ?? '[]')) } catch { /* пустой прайс — допустимо, распарсим позже */ }
  if (!Array.isArray(items)) items = []
  if (items.length > 5000) return NextResponse.json({ error: 'слишком много строк в прайсе' }, { status: 400 })

  const supa = createServiceClient()
  const server = await createServerClient()
  const { data: { user } } = await server.auth.getUser()

  const { data: list, error } = await supa
    .from('glass_price_lists')
    .insert({
      supplier, supplier_id: supplierId, title: title || file.name,
      price_date: priceDate, vat_percent: Number.isFinite(vat) ? vat : 22,
      file_name: file.name, file_size: file.size, file_mime: file.type || 'application/octet-stream',
      notes, uploaded_by: user?.id ?? null,
      parse_meta: JSON.parse(String(form.get('parse_meta') ?? '{}') || '{}'),
    })
    .select()
    .single()
  if (error || !list) return NextResponse.json({ error: error?.message ?? 'не удалось создать версию' }, { status: 500 })

  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `supplier-price/glass/${list.id}/${safeName}`
  const up = await supa.storage.from(PRICE_BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (up.error) {
    await supa.from('glass_price_lists').delete().eq('id', list.id)
    return NextResponse.json({ error: `файл не загрузился: ${up.error.message}` }, { status: 500 })
  }
  await supa.from('glass_price_lists').update({ file_path: path }).eq('id', list.id)

  if (items.length) {
    const rows = items
      .filter(i => i.product && i.variantCode)
      .map((i, n) => ({
        list_id: list.id,
        section: (i.section ?? '').slice(0, 200),
        product: String(i.product).slice(0, 200),
        variant_code: String(i.variantCode).slice(0, 40),
        thickness_mm: i.thicknessMm ?? null,
        sheet_format: (i.sheetFormat ?? '').slice(0, 60),
        price_per_m2: i.pricePerM2 ?? null,
        note: (i.note ?? '').slice(0, 200),
        sort_order: i.sortOrder ?? n,
      }))
    const seen = new Set<string>()
    const unique = rows.filter(r => {
      const k = `${r.section}|${r.product}|${r.variant_code}`
      if (seen.has(k)) return false
      seen.add(k); return true
    })
    const { error: itemsErr } = await supa.from('glass_price_list_items').insert(unique)
    if (itemsErr) return NextResponse.json({ error: `строки не сохранились: ${itemsErr.message}`, id: list.id }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: list.id, items: items.length, file_path: path })
}
