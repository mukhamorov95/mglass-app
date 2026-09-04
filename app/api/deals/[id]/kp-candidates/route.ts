import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor, canSeeDeal } from '@/lib/b2c/dealScope'
import { phoneKey } from '@/lib/b2c/phoneKey'

export const dynamic = 'force-dynamic'

// КП, сделанные ДО того, как появилась сделка (deal_id пуст), — их надо уметь
// подтянуть в карточку. Молча не склеиваем: отдаём кандидатов, привязывает человек.
// Кандидат — свободное КП, у которого совпал телефон клиента или имя.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const svc = createServiceClient()
  const { data: deal } = await svc.from('deals').select('id, client_name, phone, created_by, manager_id').eq('id', dealId).maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 })
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  // Берём свободные КП и отбираем в коде: телефон в базе записан как попало,
  // сравнивать надо по последним 10 цифрам, а не строкой (phoneKey).
  const { data: kps } = await svc.from('commercial_proposals')
    .select('id, number, client_name, client_phone, client_address, total, status, created_at, manager_name')
    .is('deal_id', null)
    .order('created_at', { ascending: false })
    .limit(300)

  const d = deal as Record<string, unknown>
  const pk = phoneKey(d.phone)
  const name = String(d.client_name ?? '').trim().toLowerCase()
  const matched = (kps ?? []).filter(k => {
    const kp = phoneKey(k.client_phone)
    if (pk && kp && pk === kp) return true
    const kn = String(k.client_name ?? '').trim().toLowerCase()
    return !!name && !!kn && (kn === name || kn.includes(name) || name.includes(kn))
  })

  // Совпадений нет — отдаём последние свободные КП: номер менеджер знает и выберет сам.
  return NextResponse.json(
    { candidates: matched.length ? matched : (kps ?? []).slice(0, 30), matched: matched.length > 0 },
    { headers: { 'Cache-Control': 'no-store' } })
}

// Привязка выбранного КП к сделке; detach — отвязать.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const b = await req.json().catch(() => ({})) as { kp_id?: number; detach?: boolean }
  const kpId = Number(b.kp_id)
  if (!Number.isFinite(kpId)) return NextResponse.json({ error: 'Нужен kp_id' }, { status: 400 })

  const svc = createServiceClient()
  const { data: deal } = await svc.from('deals').select('id, created_by, manager_id').eq('id', dealId).maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 })
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  const { error } = await svc.from('commercial_proposals')
    .update({ deal_id: b.detach ? null : dealId })
    .eq('id', kpId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
