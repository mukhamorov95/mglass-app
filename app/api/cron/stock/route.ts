import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'
import { UNIT_LABELS, toOrderQty } from '@/lib/inventory/units'
import type { Unit } from '@/lib/inventory/types'

export const runtime = 'nodejs'
export const maxDuration = 30

type Row = { name: string; unit: Unit; qty: number; min_qty: number; target_qty: number; location: string }

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data } = await supabase
    .from('inventory_items')
    .select('name, unit, qty, min_qty, target_qty, location')
    .eq('active', true)
    .gt('min_qty', 0)

  const rows = (data ?? []) as Row[]
  const out  = rows.filter(r => r.qty <= 0)
  const low  = rows.filter(r => r.qty > 0 && r.qty <= r.min_qty)

  if (!low.length && !out.length) return NextResponse.json({ ok: true, alerts: 0 })

  const line = (r: Row, icon: string) => {
    const need = toOrderQty(r)
    const u    = UNIT_LABELS[r.unit] ?? r.unit
    return `${icon} <b>${r.name}</b> — ${r.qty} ${u} (мин. ${r.min_qty})` +
           (need > 0 ? ` · закупить ${need} ${u}` : '')
  }

  await notifyAdmins([
    `📦 <b>Дефицит на складе (${out.length + low.length} позиций)</b>`,
    '',
    ...out.map(r => line(r, '🔴')),
    ...low.map(r => line(r, '🟡')),
  ].join('\n'))

  return NextResponse.json({ ok: true, alerts: out.length + low.length })
}
