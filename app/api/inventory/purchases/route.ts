import { NextResponse } from 'next/server'
import { requireInventoryRead } from '@/lib/inventory/auth'
import { createServiceClient } from '@/lib/supabase-service'

export const runtime = 'nodejs'

export type PurchaseLine = {
  name:      string
  thickness: number | null
  sheets:    number
  area_m2:   number
  cost:      number
}

export type PurchaseDoc = {
  id:            number
  supplier_name: string
  invoice_number: string | null
  status:        string
  expected:      string | null
  received:      boolean   // уже оприходована на склад
  lines:         PurchaseLine[]
}

const n = (v: unknown) => Number(v ?? 0) || 0
const s = (v: unknown) => typeof v === 'string' ? v : ''

// Закупки, по которым материал ещё нужно принять на склад.
export async function GET() {
  const actor = await requireInventoryRead()
  if (actor instanceof NextResponse) return actor

  const db = createServiceClient()
  const [po, moves] = await Promise.all([
    db.from('purchase_orders')
      .select('id, supplier_name, invoice_number, status, expected_date, expected_at, items')
      .neq('status', 'closed').order('id', { ascending: false }).limit(40),
    db.from('inventory_moves').select('doc_id').eq('doc_type', 'purchase_order').eq('reason', 'purchase'),
  ])

  const done = new Set((moves.data ?? []).map(m => String(m.doc_id)))

  type Row = {
    id: number; supplier_name: string | null; invoice_number: string | null; status: string
    expected_date: string | null; expected_at: string | null; items: unknown
  }

  const docs: PurchaseDoc[] = ((po.data ?? []) as Row[]).map(o => {
    const raw = Array.isArray(o.items) ? o.items as Record<string, unknown>[] : []
    return {
      id: o.id,
      supplier_name: o.supplier_name ?? 'Поставщик не указан',
      invoice_number: o.invoice_number,
      status: o.status,
      expected: o.expected_date ?? o.expected_at,
      received: done.has(String(o.id)),
      lines: raw.map(i => ({
        name:      s(i.material_name) || s(i.name) || 'Позиция',
        thickness: i.thickness != null ? n(i.thickness) : null,
        sheets:    n(i.sheets_count),
        area_m2:   n(i.area_m2) || n(i.required_area_m2),
        cost:      n(i.estimated_cost),
      })).filter(l => l.sheets > 0 || l.area_m2 > 0),
    }
  })

  return NextResponse.json({ docs })
}
