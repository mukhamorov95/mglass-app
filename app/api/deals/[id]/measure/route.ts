import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor, canSeeDeal } from '@/lib/b2c/dealScope'

export const dynamic = 'force-dynamic'

// Отправить сделку на замер: создаёт measure_request с deal_id и данными из сделки
// (клиент, телефон, адрес) — менеджер их не вводит заново. Замерщик увидит заявку в
// своём кабинете; отметка и файлы вернутся в карточку через deal_id.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const svc = createServiceClient()
  const { data: deal } = await svc.from('deals')
    .select('id, client_name, phone, address, created_by, manager_id').eq('id', dealId).maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 })
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  const b = await req.json().catch(() => ({})) as { scope?: string; notes?: string }

  const { data, error } = await svc.from('measure_requests').insert({
    deal_id: dealId,
    client_name: (deal.client_name as string) || '',
    phone: (deal.phone as string) || null,
    address: (deal.address as string) || null,
    scope: b.scope?.trim() || null,
    notes: b.notes?.trim() || null,
    manager_id: actor.userId,
    manager_name: actor.name,
    measurer_fee: 0,
    status: 'new',
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}
