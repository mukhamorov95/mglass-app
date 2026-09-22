import { NextResponse } from 'next/server'
import { getRole, isOwnerRole } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { refreshCoaching } from '@/lib/coaching/store'
import type { Coaching } from '@/lib/coaching/rules'

export const runtime = 'nodejs'
export const maxDuration = 300

const OWNER_VIEW = ['admin', 'ceo', 'commercial']

// Менеджер видит ТОЛЬКО свой снимок: id берётся из его же строки users по сессии,
// параметром его не подменить. Владелец и коммерческий — любой (превью «что видит менеджер»).
export async function GET(req: Request) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })
  const canSeeAll = isOwnerRole(role) || OWNER_VIEW.includes(role)
  if (!canSeeAll && role !== 'manager') return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })

  const svc = createServiceClient()
  if (canSeeAll) {
    const asked = new URL(req.url).searchParams.get('amo_user_id')
    if (!asked) {
      const { data, error } = await svc.from('manager_coaching').select('amo_user_id, name, computed_at').gt('amo_user_id', 0).order('name')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ managers: data ?? [] })
    }
    return one(svc, Number(asked))
  }

  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })
  const { data: me, error } = await svc.from('users').select('amo_user_id').eq('id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!me?.amo_user_id) return NextResponse.json({ coaching: null, reason: 'Учётка не связана с AmoCRM — скажите администратору' })
  return one(svc, Number(me.amo_user_id))
}

async function one(svc: ReturnType<typeof createServiceClient>, amoUserId: number) {
  if (!Number.isInteger(amoUserId) || amoUserId <= 0) return NextResponse.json({ error: 'Неверный amo_user_id' }, { status: 400 })
  const { data, error } = await svc.from('manager_coaching').select('payload, computed_at').eq('amo_user_id', amoUserId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ coaching: null, reason: 'Снимок ещё не считался' })
  return NextResponse.json({ coaching: data.payload as Coaching, computedAt: data.computed_at })
}

// Пересчёт по кнопке — только владелец: полный сбор занимает около минуты запросов к amo.
export async function POST() {
  const role = await getRole()
  if (!isOwnerRole(role)) return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })
  try {
    return NextResponse.json({ ok: true, ...await refreshCoaching(createServiceClient()) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
