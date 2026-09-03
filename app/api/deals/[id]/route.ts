import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor, canSeeDeal } from '@/lib/b2c/dealScope'

export const dynamic = 'force-dynamic'

// Карточка сделки: сама сделка + её расчёты. Статус НЕ хранится — производная от
// содержимого (есть расчёт → КП → …), считается на фронте из состава.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const svc = createServiceClient()
  const { data: deal, error } = await svc.from('deals')
    .select('id, client_name, phone, phone_key, address, manager_id, amo_lead_id, created_by, created_by_name, created_at, updated_at')
    .eq('id', dealId).maybeSingle()
  if (error || !deal) return NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 })
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  const { data: calcs } = await svc.from('calculations')
    .select('id, product_type, final_price, margin, status, created_at, created_by, client_name, client_phone, parent_calc_id, input_data')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: true })

  return NextResponse.json({ deal, calculations: calcs ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const svc = createServiceClient()
  const { data: deal } = await svc.from('deals').select('id, created_by, manager_id').eq('id', dealId).maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 })
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  const b = await req.json().catch(() => ({})) as { client_name?: string; phone?: string; address?: string; amo_lead_id?: string | null }
  const { phoneKey } = await import('@/lib/b2c/phoneKey')
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (b.client_name !== undefined) patch.client_name = b.client_name.trim()
  if (b.phone !== undefined) { patch.phone = b.phone.trim(); patch.phone_key = phoneKey(b.phone) }
  if (b.address !== undefined) patch.address = b.address.trim()
  // amo_lead_id менеджер привязывает вручную; из Amo только читаем.
  if (b.amo_lead_id !== undefined) patch.amo_lead_id = b.amo_lead_id?.trim() || null

  const { error } = await svc.from('deals').update(patch).eq('id', dealId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
