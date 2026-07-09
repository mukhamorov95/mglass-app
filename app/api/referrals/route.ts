import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { buildAutoTurnover, type RefClient } from '@/lib/referralTurnover'

// Реферальный заработок — данные ведёт владелец. Партнёр (сотрудник с
// users.referral_rate_pct) видит их read-only в «Мой заработок» (/api/referrals/my).
// Оборот: для клиентов, привязанных к CRM (b2b_client_id), — АВТОМАТИЧЕСКИ из
// b2b_orders помесячно с 2026 года; для непривязанных — ручной referral_turnover.

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const sb = createServiceClient()
  const [{ data: users }, { data: clients }, { data: turnover }] = await Promise.all([
    sb.from('users').select('id,name,email,role,referral_rate_pct').eq('active', true).order('name'),
    sb.from('referral_clients').select('id,referrer_id,name,note,b2b_client_id').order('name'),
    sb.from('referral_turnover').select('referral_client_id,ym,amount').order('ym'),
  ])
  const autoTurnover = await buildAutoTurnover(sb, (clients ?? []) as RefClient[])

  return NextResponse.json({
    users: users ?? [],
    clients: clients ?? [],
    turnover: turnover ?? [],
    autoTurnover,
  })
}

const normYm = (ym: string) => /^\d{4}-\d{2}$/.test(ym) ? `${ym}-01` : ym

export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const sb = createServiceClient()
  const body = await req.json().catch(() => ({}))
  const action = body.action as string

  if (action === 'set_rate') {
    const rate = body.rate === null || body.rate === '' ? null : Number(body.rate)
    if (!body.userId) return NextResponse.json({ error: 'нет userId' }, { status: 400 })
    if (rate !== null && (!isFinite(rate) || rate < 0)) return NextResponse.json({ error: 'ставка некорректна' }, { status: 400 })
    const { error } = await sb.from('users').update({ referral_rate_pct: rate }).eq('id', body.userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_client') {
    if (!body.referrerId) return NextResponse.json({ error: 'нет referrerId' }, { status: 400 })
    let b2bClientId: number | null = body.b2bClientId ? Number(body.b2bClientId) : null
    let name = String(body.name ?? '').trim()

    if (b2bClientId) {
      // привязка существующего клиента CRM — имя берём из карточки
      const { data: b2bc } = await sb.from('b2b_clients').select('id,name').eq('id', b2bClientId).maybeSingle()
      if (!b2bc) return NextResponse.json({ error: 'B2B-клиент не найден' }, { status: 404 })
      name = b2bc.name
      const { data: dup } = await sb.from('referral_clients').select('id').eq('b2b_client_id', b2bClientId).maybeSingle()
      if (dup) return NextResponse.json({ error: 'этот клиент уже привязан к партнёру' }, { status: 409 })
    } else {
      if (!name) return NextResponse.json({ error: 'нужно имя клиента' }, { status: 400 })
      if (body.createInCrm) {
        // сразу заводим карточку в B2B-клиентах (CRM) и привязываем
        const { data: created, error: cErr } = await sb.from('b2b_clients')
          .insert({ name, active: true, discount_percent: 0, organization_id: 1, crm_status: 'new', notes: 'Приведён по партнёрской программе' })
          .select('id').single()
        if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
        b2bClientId = created.id
      }
    }

    const { data, error } = await sb.from('referral_clients')
      .insert({ referrer_id: body.referrerId, name, note: String(body.note ?? '').trim() || null, b2b_client_id: b2bClientId })
      .select('id,referrer_id,name,note,b2b_client_id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ client: data })
  }

  if (action === 'del_client') {
    if (!body.clientId) return NextResponse.json({ error: 'нет clientId' }, { status: 400 })
    const { error } = await sb.from('referral_clients').delete().eq('id', body.clientId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'set_turnover') {
    const amount = Number(body.amount)
    if (!body.clientId || !body.ym) return NextResponse.json({ error: 'нужны clientId и ym' }, { status: 400 })
    if (!isFinite(amount) || amount < 0) return NextResponse.json({ error: 'сумма некорректна' }, { status: 400 })
    const { error } = await sb.from('referral_turnover')
      .upsert({ referral_client_id: body.clientId, ym: normYm(body.ym), amount }, { onConflict: 'referral_client_id,ym' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'неизвестное действие' }, { status: 400 })
}
