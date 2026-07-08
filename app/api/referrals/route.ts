import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Реферальный заработок — данные ведёт владелец. Партнёр (сотрудник с
// users.referral_rate_pct) видит их read-only в «Мой заработок» через RLS.
// Все записи идут отсюда на сервис-роли после owner-гейта.

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const sb = createServiceClient()
  const [{ data: users }, { data: clients }, { data: turnover }] = await Promise.all([
    sb.from('users').select('id,name,email,role,referral_rate_pct').eq('active', true).order('name'),
    sb.from('referral_clients').select('id,referrer_id,name,note').order('name'),
    sb.from('referral_turnover').select('referral_client_id,ym,amount').order('ym'),
  ])

  return NextResponse.json({
    users: users ?? [],
    clients: clients ?? [],
    turnover: turnover ?? [],
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
    const name = String(body.name ?? '').trim()
    if (!body.referrerId || !name) return NextResponse.json({ error: 'нужны referrerId и name' }, { status: 400 })
    const { data, error } = await sb.from('referral_clients')
      .insert({ referrer_id: body.referrerId, name, note: String(body.note ?? '').trim() || null })
      .select('id,referrer_id,name,note').single()
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
