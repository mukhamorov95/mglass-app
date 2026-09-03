import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor, canSeeDeal } from '@/lib/b2c/dealScope'

export const dynamic = 'force-dynamic'

// Ручная привязка расчёта к сделке (человек решает — кейсы 1–2 из правила владельца)
// и отвязка (calc_id → deal_id=null). Склейка только через это явное действие.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const b = await req.json().catch(() => ({})) as { calc_id?: number; detach?: boolean }
  const calcId = Number(b.calc_id)
  if (!Number.isFinite(calcId)) return NextResponse.json({ error: 'Нужен calc_id' }, { status: 400 })

  const svc = createServiceClient()
  const { data: deal } = await svc.from('deals').select('id, created_by, manager_id').eq('id', dealId).maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 })
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  const { error } = await svc.from('calculations')
    .update({ deal_id: b.detach ? null : dealId })
    .eq('id', calcId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
