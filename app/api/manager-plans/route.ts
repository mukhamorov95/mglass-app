import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

// План менеджера на месяц в поступлениях (М6). Ставит только владелец — на «Команде».
// Тело: { month: 'YYYY-MM', plans: [{ amoUserId, plan }] }; plan = null снимает план.

const MAX_PLAN = 1_000_000_000

export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const user = await getSessionUser()

  const body = await req.json().catch(() => null) as { month?: unknown; plans?: unknown } | null
  const month = typeof body?.month === 'string' ? body.month : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: 'Месяц в формате ГГГГ-ММ' }, { status: 400 })
  if (!Array.isArray(body?.plans) || !body.plans.length || body.plans.length > 50) {
    return NextResponse.json({ error: 'Нет планов для сохранения' }, { status: 400 })
  }

  const rows: { month: string; amo_user_id: number; plan_money: number | null; updated_at: string; updated_by: string | null }[] = []
  for (const p of body.plans as { amoUserId?: unknown; plan?: unknown }[]) {
    const id = Number(p?.amoUserId)
    const plan = p?.plan == null || p.plan === '' ? null : Number(p.plan)
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: 'Неверный менеджер' }, { status: 400 })
    if (plan != null && (!Number.isFinite(plan) || plan < 0 || plan > MAX_PLAN)) {
      return NextResponse.json({ error: 'План — сумма в рублях от 0' }, { status: 400 })
    }
    rows.push({ month, amo_user_id: id, plan_money: plan == null ? null : Math.round(plan), updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
  }

  const sb = createServiceClient()
  const { data: sellers, error: sErr } = await sb.from('manager_schedules').select('amo_user_id').eq('is_seller', true)
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
  const known = new Set((sellers ?? []).map(s => Number(s.amo_user_id)))
  const stranger = rows.find(r => !known.has(r.amo_user_id))
  if (stranger) return NextResponse.json({ error: `amo #${stranger.amo_user_id} не продавец по графику` }, { status: 400 })

  const { data, error } = await sb.from('manager_month_plans')
    .upsert(rows, { onConflict: 'month,amo_user_id' })
    .select('month, amo_user_id, plan_money')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if ((data ?? []).length !== rows.length) return NextResponse.json({ error: 'Сохранилось не всё — обновите страницу' }, { status: 500 })
  return NextResponse.json({ saved: data })
}
