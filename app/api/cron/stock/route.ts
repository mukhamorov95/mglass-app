import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: materials } = await supabase
    .from('materials')
    .select('name, unit, stock_qty, min_stock_qty')
    .eq('active', true)
    .gt('min_stock_qty', 0)

  type MaterialRow = { name: string; unit: string; stock_qty: number; min_stock_qty: number }
  const rows = (materials ?? []) as MaterialRow[]
  const low  = rows.filter(m => m.stock_qty > 0 && m.stock_qty <= m.min_stock_qty)
  const out  = rows.filter(m => m.stock_qty <= 0 && m.min_stock_qty > 0)

  if (!low.length && !out.length) return NextResponse.json({ ok: true, alerts: 0 })

  const lines: string[] = []
  for (const m of out)  lines.push(`🔴 <b>${m.name}</b> — нет на складе (мин. ${m.min_stock_qty} ${m.unit})`)
  for (const m of low)  lines.push(`🟡 <b>${m.name}</b> — ${m.stock_qty} ${m.unit} (мин. ${m.min_stock_qty})`)

  await notifyAdmins([
    `📦 <b>Дефицит на складе (${out.length + low.length} позиций)</b>`,
    '',
    ...lines,
  ].join('\n'))

  return NextResponse.json({ ok: true, alerts: out.length + low.length })
}
