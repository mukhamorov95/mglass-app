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

  const low  = (materials ?? []).filter((m: any) => m.stock_qty > 0 && m.stock_qty <= m.min_stock_qty)
  const out  = (materials ?? []).filter((m: any) => m.stock_qty <= 0 && m.min_stock_qty > 0)

  if (!low.length && !out.length) return NextResponse.json({ ok: true, alerts: 0 })

  const lines: string[] = []
  for (const m of out)  lines.push(`🔴 <b>${(m as any).name}</b> — нет на складе (мин. ${(m as any).min_stock_qty} ${(m as any).unit})`)
  for (const m of low)  lines.push(`🟡 <b>${(m as any).name}</b> — ${(m as any).stock_qty} ${(m as any).unit} (мин. ${(m as any).min_stock_qty})`)

  await notifyAdmins([
    `📦 <b>Дефицит на складе (${out.length + low.length} позиций)</b>`,
    '',
    ...lines,
  ].join('\n'))

  return NextResponse.json({ ok: true, alerts: out.length + low.length })
}
