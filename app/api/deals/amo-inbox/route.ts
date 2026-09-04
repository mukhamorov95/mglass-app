import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor } from '@/lib/b2c/dealScope'
import { getLeads, getPipelines, getUsers } from '@/lib/amocrm'

export const dynamic = 'force-dynamic'

// Заявки из AmoCRM, которых ЕЩЁ НЕТ в системе: менеджер видит свои, владелец — все.
// Только чтение CRM (жёсткое правило проекта): ни одного POST/PATCH в Amo отсюда нет.
// Импорт (создание нашей сделки) делает соседний роут /api/deals/amo-import.

const DEFAULT_FROM = '2026-09-01'   // владелец: «начиная с сентября»

export async function GET(req: NextRequest) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const svc = createServiceClient()

  const fromStr = req.nextUrl.searchParams.get('from') || DEFAULT_FROM
  const fromTs = Math.floor(new Date(`${fromStr}T00:00:00+03:00`).getTime() / 1000)
  if (!Number.isFinite(fromTs)) return NextResponse.json({ error: 'Некорректная дата' }, { status: 400 })

  // Менеджер видит только свои заявки — по его amo_user_id. Нет привязки к Amo →
  // показывать чужое нельзя, поэтому отдаём пусто и объясняем причину.
  let amoUserId: number | null = null
  if (!actor.seeAll) {
    const { data: u } = await svc.from('users').select('amo_user_id').eq('id', actor.userId).maybeSingle()
    amoUserId = Number((u as { amo_user_id?: number } | null)?.amo_user_id) || null
    if (!amoUserId) {
      return NextResponse.json({ leads: [], needsAmoLink: true }, { headers: { 'Cache-Control': 'no-store' } })
    }
  }

  const params: Record<string, string> = {
    'filter[created_at][from]': String(fromTs),
    'order[created_at]': 'desc',
    with: 'contacts',
  }
  if (amoUserId) params['filter[responsible_user_id]'] = String(amoUserId)

  let leads
  try {
    leads = await getLeads(params)
  } catch (e) {
    return NextResponse.json({ error: `AmoCRM недоступна: ${(e as Error).message}` }, { status: 502 })
  }

  // Уже импортированные отсекаем по amo_lead_id — второй раз ту же заявку не заводим.
  const { data: mine } = await svc.from('deals').select('amo_lead_id').not('amo_lead_id', 'is', null).limit(2000)
  const taken = new Set((mine ?? []).map(d => String((d as { amo_lead_id: string }).amo_lead_id)))

  const [pipelines, users] = await Promise.all([
    getPipelines().catch(() => []),
    getUsers().catch(() => []),
  ])
  const stageName = new Map<number, string>()
  for (const p of pipelines) for (const st of p._embedded?.statuses ?? []) stageName.set(st.id, st.name)
  const userName = new Map<number, string>(users.map(u => [u.id, u.name]))

  const list = leads
    .filter(l => !taken.has(String(l.id)))
    .slice(0, 100)
    .map(l => ({
      id: l.id,
      name: l.name,
      stage: stageName.get(l.status_id) ?? String(l.status_id),
      manager: userName.get(l.responsible_user_id) ?? '',
      createdAt: new Date(l.created_at * 1000).toISOString(),
    }))

  return NextResponse.json({ leads: list, from: fromStr }, { headers: { 'Cache-Control': 'no-store' } })
}
