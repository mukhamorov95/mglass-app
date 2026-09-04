import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor, canSeeDeal } from '@/lib/b2c/dealScope'
import { dealStage, dealValue, emptyArtifacts } from '@/lib/b2c/dealProgress'

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
    .select('id, client_name, phone, phone_key, address, manager_id, amo_lead_id, source, archived_at, created_by, created_by_name, created_at, updated_at')
    .eq('id', dealId).maybeSingle()
  if (error || !deal) return NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 })
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  const { data: calcs } = await svc.from('calculations')
    .select('id, product_type, final_price, margin, status, created_at, created_by, client_name, client_phone, parent_calc_id, input_data')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: true })

  // Другие сделки того же клиента (тот же нормализованный телефон) — владелец:
  // «сделки этого клиента тоже». Объект у нас отдельная сделка, поэтому у одного
  // человека их может быть несколько, и из карточки надо видеть остальные.
  let siblings: Record<string, unknown>[] = []
  const pk = (deal as Record<string, unknown>).phone_key as string | null
  if (pk) {
    let q = svc.from('deals').select('id, client_name, address, created_at, archived_at')
      .eq('phone_key', pk).neq('id', dealId).order('created_at', { ascending: false }).limit(20)
    if (!actor.seeAll) q = q.or(`created_by.eq.${actor.userId},manager_id.eq.${actor.userId}`)
    const { data } = await q
    siblings = (data ?? []) as Record<string, unknown>[]
  }

  // Этаж и деньги считаем ТЕМ ЖЕ кодом, что доска: раньше карточка знала только
  // про расчёты и показывала «Новая · 0 ₽» у сделки с договором на 775 000.
  const [{ data: kps }, { data: contracts }, { data: pays }] = await Promise.all([
    svc.from('commercial_proposals').select('total, created_at').eq('deal_id', dealId).order('created_at', { ascending: true }),
    svc.from('contracts').select('total, created_at').eq('deal_id', dealId).order('created_at', { ascending: true }),
    svc.from('deal_payments').select('amount').eq('deal_id', dealId),
  ])
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  const art = emptyArtifacts()
  for (const c of (calcs ?? []) as Record<string, unknown>[]) {
    art.calcCount++
    art.calcMax = Math.max(art.calcMax, num(c.final_price))
    if (c.status === 'sent' || c.status === 'approved') art.hasSentCalc = true
  }
  for (const k of (kps ?? []) as Record<string, unknown>[]) { art.kpCount++; art.kpTotal = num(k.total) }
  for (const c of (contracts ?? []) as Record<string, unknown>[]) { art.contractCount++; art.contractTotal = num(c.total) }
  for (const p of (pays ?? []) as Record<string, unknown>[]) { art.paid += num(p.amount); art.payCount++ }
  const money = dealValue(art)
  const stage = dealStage(art)

  return NextResponse.json(
    { deal, calculations: calcs ?? [], siblings, stage, money },
    { headers: { 'Cache-Control': 'no-store' } })
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

  const b = await req.json().catch(() => ({})) as {
    client_name?: string; phone?: string; address?: string; amo_lead_id?: string | null
    source?: string | null; archived?: boolean
  }
  const { phoneKey } = await import('@/lib/b2c/phoneKey')
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (b.client_name !== undefined) patch.client_name = b.client_name.trim()
  if (b.phone !== undefined) { patch.phone = b.phone.trim(); patch.phone_key = phoneKey(b.phone) }
  if (b.address !== undefined) patch.address = b.address.trim()
  // amo_lead_id менеджер привязывает вручную; из Amo только читаем.
  if (b.amo_lead_id !== undefined) patch.amo_lead_id = b.amo_lead_id?.trim() || null
  if (b.source !== undefined) patch.source = b.source?.trim() || null
  // Архив вместо удаления: к сделке привязаны расчёты, КП, договоры, замеры и
  // деньги — жёсткое удаление необратимо, поэтому его нет вовсе.
  if (b.archived !== undefined) {
    patch.archived_at = b.archived ? new Date().toISOString() : null
    patch.archived_by = b.archived ? actor.userId : null
  }

  const { error } = await svc.from('deals').update(patch).eq('id', dealId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
