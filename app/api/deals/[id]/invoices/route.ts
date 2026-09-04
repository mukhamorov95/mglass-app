import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor, canSeeDeal } from '@/lib/b2c/dealScope'

export const dynamic = 'force-dynamic'

// Счета сделки. Статус «оплачен» НЕ хранится галочкой: он выводится из суммы
// оплат, привязанных к счёту, — иначе появится второе место правды о деньгах.

const PURPOSES = new Set(['prepay', 'balance', 'install', 'full'])

async function guard(dealId: number) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return { res: actor }
  const svc = createServiceClient()
  const { data: deal } = await svc.from('deals').select('id, created_by, manager_id').eq('id', dealId).maybeSingle()
  if (!deal) return { res: NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 }) }
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return { res: NextResponse.json({ error: 'Нет доступа' }, { status: 403 }) }
  }
  return { actor, svc }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })
  const g = await guard(dealId)
  if ('res' in g) return g.res

  const [{ data: invoices }, { data: pays }] = await Promise.all([
    g.svc.from('deal_invoices')
      .select('id, number, amount, purpose, issued_at, due_at, status, contract_id, created_by_name, created_at')
      .eq('deal_id', dealId).order('created_at', { ascending: false }),
    g.svc.from('deal_payments').select('invoice_id, amount').eq('deal_id', dealId),
  ])

  // Сколько денег пришло по каждому счёту — считаем здесь, а не храним.
  const paidBy = new Map<number, number>()
  for (const p of (pays ?? []) as { invoice_id: number | null; amount: number }[]) {
    if (p.invoice_id == null) continue
    paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + (Number(p.amount) || 0))
  }
  const list = (invoices ?? []).map(i => {
    const paid = paidBy.get(i.id) ?? 0
    const amount = Number(i.amount) || 0
    return {
      ...i, paid,
      remaining: Math.max(0, amount - paid),
      state: i.status === 'cancelled' ? 'cancelled' : paid >= amount - 1 && amount > 0 ? 'paid' : 'issued',
    }
  })
  return NextResponse.json({ invoices: list }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })
  const g = await guard(dealId)
  if ('res' in g) return g.res

  const b = await req.json().catch(() => ({})) as {
    amount?: number; purpose?: string; due_at?: string | null; contract_id?: number | null; comment?: string
  }
  const amount = Math.round(Number(b.amount) || 0)
  if (amount <= 0) return NextResponse.json({ error: 'Сумма счёта должна быть больше нуля' }, { status: 400 })
  const purpose = PURPOSES.has(String(b.purpose)) ? String(b.purpose) : 'prepay'

  const { data: numRow, error: numErr } = await g.svc.rpc('next_deal_invoice_number')
  if (numErr) return NextResponse.json({ error: numErr.message }, { status: 500 })

  const { data, error } = await g.svc.from('deal_invoices').insert({
    deal_id: dealId,
    contract_id: b.contract_id ?? null,
    number: String(numRow),
    amount, purpose,
    due_at: b.due_at || null,
    comment: b.comment?.trim() || null,
    created_by: g.actor.userId,
    created_by_name: g.actor.name,
  }).select('id, number').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id, number: data.number })
}

// Отмена счёта: запись остаётся, номер не переиспользуется.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })
  const g = await guard(dealId)
  if ('res' in g) return g.res

  const b = await req.json().catch(() => ({})) as { invoice_id?: number; status?: string }
  const invId = Number(b.invoice_id)
  if (!Number.isFinite(invId)) return NextResponse.json({ error: 'Нужен invoice_id' }, { status: 400 })
  const status = b.status === 'cancelled' ? 'cancelled' : 'issued'

  const { error } = await g.svc.from('deal_invoices')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', invId).eq('deal_id', dealId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
