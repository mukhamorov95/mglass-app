import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor, canSeeDeal } from '@/lib/b2c/dealScope'

export const dynamic = 'force-dynamic'

// Оплаты сделки: предоплата · остаток · остаток за монтаж. Сумма свободная (не из %),
// отметок одного вида может быть несколько, дата поступления (paid_at) отдельно от даты
// записи. Скоуп — как /api/deals: сервис-клиент + requireDealActor/canSeeDeal (RLS —
// защита в глубину). Зарабатывающий менеджер сделки — deals.manager_id.

const KINDS = new Set(['prepay', 'balance', 'install'])

async function guard(id: string) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return { err: actor as NextResponse }
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return { err: NextResponse.json({ error: 'Некорректный id' }, { status: 400 }) }
  const svc = createServiceClient()
  const { data: deal } = await svc.from('deals').select('created_by, manager_id').eq('id', dealId).maybeSingle()
  if (!deal) return { err: NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 }) }
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return { err: NextResponse.json({ error: 'Нет доступа' }, { status: 403 }) }
  }
  return { actor, dealId, svc }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const { data } = await g.svc.from('deal_payments')
    .select('id, kind, amount, paid_at, entered_by_name, note, invoice_id, created_at')
    .eq('deal_id', g.dealId).order('paid_at', { ascending: true })
  return NextResponse.json({ payments: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const b = await req.json().catch(() => ({})) as { kind?: string; amount?: number; paid_at?: string; note?: string; invoice_id?: number | null }
  if (!b.kind || !KINDS.has(b.kind)) return NextResponse.json({ error: 'kind: предоплата/остаток/остаток за монтаж' }, { status: 400 })
  const amount = Number(b.amount)
  if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: 'Некорректная сумма' }, { status: 400 })

  const { data, error } = await g.svc.from('deal_payments').insert({
    deal_id: g.dealId,
    kind: b.kind,
    amount,
    paid_at: b.paid_at || new Date().toISOString().slice(0, 10),
    entered_by: g.actor.userId,
    entered_by_name: g.actor.name,
    note: b.note?.trim() || null,
    // Оплата может закрывать конкретный счёт; без счёта — просто деньги по сделке.
    invoice_id: Number.isFinite(Number(b.invoice_id)) ? Number(b.invoice_id) : null,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const b = await req.json().catch(() => ({})) as { payment_id?: number }
  if (!b.payment_id) return NextResponse.json({ error: 'payment_id обязателен' }, { status: 400 })
  const { error } = await g.svc.from('deal_payments').delete().eq('id', b.payment_id).eq('deal_id', g.dealId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
