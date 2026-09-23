import { NextResponse } from 'next/server'
import { getRole, isOwnerRole } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { refreshCoaching } from '@/lib/coaching/store'
import { buildFocus, type Coaching, type ManagerFacts } from '@/lib/coaching/rules'
import { collectFocusLive } from '@/lib/coaching/focus'

export const runtime = 'nodejs'
export const maxDuration = 300

const OWNER_VIEW = ['admin', 'ceo', 'commercial']

// Менеджер видит ТОЛЬКО свой снимок: id берётся из его же строки users по сессии,
// параметром его не подменить. Владелец и коммерческий — любой (превью «что видит менеджер»).
export async function GET(req: Request) {
  const live = new URL(req.url).searchParams.get('live') === '1'
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
      const { data: eff } = await svc.from('coaching_effect').select('amo_user_id, items, done, day').order('day', { ascending: false }).limit(200)
      const byUser = new Map<number, { items: number; done: number; days: number }>()
      for (const e of eff ?? []) {
        const cur = byUser.get(Number(e.amo_user_id)) ?? { items: 0, done: 0, days: 0 }
        byUser.set(Number(e.amo_user_id), { items: cur.items + e.items, done: cur.done + e.done, days: cur.days + 1 })
      }
      return NextResponse.json({ managers: (data ?? []).map(m => ({ ...m, effect: byUser.get(Number(m.amo_user_id)) ?? null })) })
    }
    return one(svc, Number(asked), live)
  }

  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })
  const { data: me, error } = await svc.from('users').select('amo_user_id').eq('id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!me?.amo_user_id) return NextResponse.json({ coaching: null, reason: 'Учётка не связана с AmoCRM — скажите администратору' })
  return one(svc, Number(me.amo_user_id), live)
}

async function one(svc: ReturnType<typeof createServiceClient>, amoUserId: number, live = false) {
  if (!Number.isInteger(amoUserId) || amoUserId <= 0) return NextResponse.json({ error: 'Неверный amo_user_id' }, { status: 400 })
  const { data, error } = await svc.from('manager_coaching').select('payload, computed_at').eq('amo_user_id', amoUserId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ coaching: null, reason: 'Снимок ещё не считался' })
  const coaching = data.payload as Coaching
  const effect = await effectFor(svc, amoUserId)
  if (!live) return NextResponse.json({ coaching, computedAt: data.computed_at, effect })

  // «Обновить»: пересчитываем только поводы этого человека (секунды), привычка и итоги —
  // из утреннего снимка: они считаются по неделе и 90 дням и за день не меняются.
  const now = Math.floor(Date.now() / 1000)
  const facts = { amoUserId, name: coaching.name, week: { replies: [], leftWaiting: 0, tasksCompleted: 0, workDays: 0 }, results: { days: 0, leadsReceived: 0, leadsDaytime: 0, leadsNoContact: 0, firstContactMedianMin: null, paidDeals: 0, paidBudget: 0 }, ...await collectFocusLive(amoUserId, now) } satisfies ManagerFacts
  const { focus, more } = buildFocus(facts, now)
  return NextResponse.json({ coaching: { ...coaching, focus, focusMore: more }, computedAt: data.computed_at, liveAt: now, effect })
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

// Сколько поводов закрывается: вчерашний день и две недели — чтобы видеть, работает ли инструмент
async function effectFor(svc: ReturnType<typeof createServiceClient>, amoUserId: number) {
  const { data, error } = await svc.from('coaching_effect')
    .select('day, items, done').eq('amo_user_id', amoUserId).order('day', { ascending: false }).limit(14)
  if (error || !data?.length) return null
  const sum = data.reduce((a, r) => ({ items: a.items + r.items, done: a.done + r.done }), { items: 0, done: 0 })
  return { last: data[0], days: data.length, ...sum }
}
