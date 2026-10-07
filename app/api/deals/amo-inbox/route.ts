import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor } from '@/lib/b2c/dealScope'
import { getLeads, getPipelines, getUsers } from '@/lib/amocrm'
import { inChunks, pageAll } from '@/lib/supabase/pageAll'

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
  // Спрашиваем только про заявки из ответа amo: «все сделки» упирались бы в потолок
  // PostgREST (1000 строк), и уже заведённая заявка снова показывалась бы к импорту.
  let taken: Set<string>
  try {
    const rows = await inChunks([...new Set(leads.map(l => String(l.id)))], 300, part =>
      pageAll<{ amo_lead_id: string }>((from, to) => svc.from('deals').select('amo_lead_id')
        .in('amo_lead_id', part).order('id').range(from, to)))
    taken = new Set(rows.map(d => String(d.amo_lead_id)))
  } catch (e) {
    return NextResponse.json({ error: `Сделки: ${(e as Error).message}` }, { status: 500 })
  }

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
