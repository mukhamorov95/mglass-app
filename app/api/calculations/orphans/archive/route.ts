import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor } from '@/lib/b2c/dealScope'

export const dynamic = 'force-dynamic'

// Убрать расчёт без клиента с глаз — и вернуть обратно. Не удаление: расчёт
// остаётся в «Расчётах» и открывается по ссылке, из «Моего дня» он лишь уходит.
//
// Service-role здесь потому, что RLS на calculations разрешает править чужие
// расчёты любому не-партнёру. Значит, скоуп проверяем сами: менеджер трогает
// только свои, владелец и «видит всех» — любые.
export async function POST(req: Request) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor

  const body = await req.json().catch(() => null) as { ids?: unknown; archived?: unknown } | null
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isFinite) : []
  const archived = body?.archived !== false
  if (ids.length === 0) return NextResponse.json({ error: 'Нечего архивировать' }, { status: 400 })
  if (ids.length > 200) return NextResponse.json({ error: 'Слишком много за раз' }, { status: 400 })

  const svc = createServiceClient()
  let q = svc.from('calculations')
    .update(archived
      ? { archived_at: new Date().toISOString(), archived_by: actor.userId }
      : { archived_at: null, archived_by: null })
    .in('id', ids)
    .is('deal_id', null)   // привязанный к сделке расчёт этим роутом не трогаем
  if (!actor.seeAll) q = q.eq('created_by', actor.userId)

  const { data, error } = await q.select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, changed: (data ?? []).map(r => r.id) })
}
