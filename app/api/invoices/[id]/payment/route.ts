import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { payInvoice, unpayInvoice } from '@/lib/money/invoiceManualPayment'
import { currentActor } from '@/lib/money/actor'
import { INVOICE_PAY_ROLES } from '@/lib/money/roles'

// «Оплачен» по счёту = платёж на остаток (POST) и снятие ручной оплаты (DELETE).
// Статус счёта после записи — по платежам (lib/money/invoiceStatus).

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...INVOICE_PAY_ROLES])
  if (guard instanceof NextResponse) return guard
  const id = Number((await params).id)
  if (!(id > 0)) return NextResponse.json({ error: 'Плохой id счёта' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { amount?: unknown; paidAt?: string }
  const actor = await currentActor()
  const res = await payInvoice(createServiceClient(), id, {
    amount: body.amount, paidAt: body.paidAt ?? null, actorId: actor.id, actorName: actor.name,
  })
  if (!res.ok) return NextResponse.json({ error: res.error, state: res.state ?? null }, { status: res.status })
  return NextResponse.json({ ok: true, payment_id: res.paymentId, ...res.state })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...INVOICE_PAY_ROLES])
  if (guard instanceof NextResponse) return guard
  const id = Number((await params).id)
  if (!(id > 0)) return NextResponse.json({ error: 'Плохой id счёта' }, { status: 400 })

  const actor = await currentActor()
  const res = await unpayInvoice(createServiceClient(), id, actor.id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, voided: res.voided, ...res.state })
}
