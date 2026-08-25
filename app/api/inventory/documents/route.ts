import { NextResponse } from 'next/server'
import { requireInventoryRead } from '@/lib/inventory/auth'
import { createServiceClient } from '@/lib/supabase-service'

export const runtime = 'nodejs'

export type ConsumeDoc = {
  doc_type: 'b2b_order' | 'order'
  doc_id:   string
  title:    string
  date:     string | null
  consumed: boolean
}

// Заказы, запущенные в работу: по ним склад должен уменьшиться.
export async function GET() {
  const actor = await requireInventoryRead()
  if (actor instanceof NextResponse) return actor

  const db = createServiceClient()
  const [b2b, b2c, moves] = await Promise.all([
    db.from('b2b_orders')
      .select('id, custom_number, client_name, launched_at, created_at')
      .not('launched_at', 'is', null).order('launched_at', { ascending: false }).limit(50),
    db.from('orders')
      .select('id, number, client_name, launched_at, created_at')
      .not('launched_at', 'is', null).order('launched_at', { ascending: false }).limit(50),
    db.from('inventory_moves')
      .select('doc_type, doc_id').in('reason', ['order', 'production']).not('doc_id', 'is', null),
  ])

  const done = new Set((moves.data ?? []).map(m => `${m.doc_type}:${m.doc_id}`))

  type B2BRow = { id: number; custom_number: string | null; client_name: string | null; launched_at: string | null; created_at: string }
  type B2CRow = { id: string; number: string | null; client_name: string | null; launched_at: string | null; created_at: string }

  const docs: ConsumeDoc[] = [
    ...((b2b.data ?? []) as B2BRow[]).map(o => ({
      doc_type: 'b2b_order' as const, doc_id: String(o.id),
      title: `B2B №${o.custom_number ?? o.id} · ${o.client_name ?? ''}`.trim(),
      date: o.launched_at ?? o.created_at,
      consumed: done.has(`b2b_order:${o.id}`),
    })),
    ...((b2c.data ?? []) as B2CRow[]).map(o => ({
      doc_type: 'order' as const, doc_id: String(o.id),
      title: `Заказ ${o.number ?? ''} · ${o.client_name ?? ''}`.trim(),
      date: o.launched_at ?? o.created_at,
      consumed: done.has(`order:${o.id}`),
    })),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  return NextResponse.json({ docs })
}
