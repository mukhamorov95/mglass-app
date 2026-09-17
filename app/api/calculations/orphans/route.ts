import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor } from '@/lib/b2c/dealScope'

export const dynamic = 'force-dynamic'

const COLS = 'id, created_at, product_type, client_name, client_phone, final_price, client_text, created_by, archived_at'
const WINDOW_DAYS = 30

// Расчёты, которые не привязаны ни к одной сделке. Быстрый расчёт разрешает
// считать «на бегу», без клиента — и такие расчёты растворялись: в воронку не
// попадали, в «Сделках» их не видно, вспомнить о них нечем. Здесь они видимы,
// чтобы менеджер закрыл хвост до конца дня.
//
// ?view=archive — то, что убрали с глаз. Архив не удаление: расчёт остаётся
// открываемым, и его можно вернуть в список.
export async function GET(req: Request) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor

  const archive = new URL(req.url).searchParams.get('view') === 'archive'
  const svc = createServiceClient()
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

  let list = svc.from('calculations').select(COLS).is('deal_id', null).limit(50)
  // Архив не режем по дате: туда кладут именно старое.
  list = archive
    ? list.not('archived_at', 'is', null).order('archived_at', { ascending: false })
    : list.is('archived_at', null).gte('created_at', since).order('created_at', { ascending: false })
  if (!actor.seeAll) list = list.eq('created_by', actor.userId)

  const { data, error } = await list
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Счётчики обеих вкладок сразу: иначе кнопка «Архив» не знает, есть ли там что,
  // и менеджер не догадается туда заглянуть.
  let activeQ = svc.from('calculations').select('id', { count: 'exact', head: true })
    .is('deal_id', null).is('archived_at', null).gte('created_at', since)
  let archQ = svc.from('calculations').select('id', { count: 'exact', head: true })
    .is('deal_id', null).not('archived_at', 'is', null)
  if (!actor.seeAll) { activeQ = activeQ.eq('created_by', actor.userId); archQ = archQ.eq('created_by', actor.userId) }
  const [active, archived] = await Promise.all([activeQ, archQ])

  const rows = data ?? []
  const ids = [...new Set(rows.map(r => r.created_by).filter(Boolean))] as string[]
  // Кто считал — первый вопрос к чужому расчёту.
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: users } = await svc.from('users').select('id, name').in('id', ids)
    for (const u of users ?? []) names.set(u.id as string, (u.name as string) ?? '')
  }

  return NextResponse.json({
    items: rows.map(r => ({ ...r, created_by_name: r.created_by ? names.get(r.created_by as string) ?? null : null })),
    counts: { active: active.count ?? 0, archived: archived.count ?? 0 },
    windowDays: WINDOW_DAYS,
  })
}
