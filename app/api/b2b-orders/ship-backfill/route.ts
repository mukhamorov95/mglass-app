import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'
import { isOwnerRole } from '@/lib/getRole'
import { mskDayKey } from '@/lib/time'
import { parseNotes, isShipped, isLaunched, backfillDateProblem, type TodayOrder } from '@/lib/b2b/todayPriorities'

// Разбор старых отгрузок без отметки (решение владельца 30.09, docs/MANAGER_UX_ROUTE.md, У3).
// Отметка — той же mark_order_stages, что у цеха (/api/production/ship), но с датой,
// которую выбрал человек: прошлые отгрузки сегодняшним числом раздули бы «отгружено
// сегодня» в цеху.
//
// Партнёру о прошлой отгрузке не пишем: крон partner-notify шлёт письмо по каждой
// отметке не старше 45 дней, и клиент получил бы пачку писем о давно полученных
// заказах. Поэтому строку уведомления кладём сами — сразу прочитанной и «отправленной»;
// крон видит, что она уже есть, и молчит. В колокольчике партнёра она остаётся историей.

const SHIP_ROLES = ['production', 'manager', 'admin', 'ceo', 'buyer', 'logist', 'commercial'] as const
const MAX_ITEMS = 200

type Item = { order_id: number; date: string }
type Skipped = { order_id: number; reason: string }

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole([...SHIP_ROLES])
  if (guard instanceof NextResponse) return guard
  const role = guard

  const body = await req.json().catch(() => ({})) as { items?: unknown }
  const items = (Array.isArray(body.items) ? body.items : [])
    .map(i => ({ order_id: Number((i as Item)?.order_id), date: String((i as Item)?.date ?? '') }))
    .filter(i => Number.isInteger(i.order_id) && i.order_id > 0)
  if (items.length === 0) return NextResponse.json({ error: 'Не выбрано ни одного заказа' }, { status: 400 })
  if (items.length > MAX_ITEMS) return NextResponse.json({ error: `За раз — не больше ${MAX_ITEMS} заказов` }, { status: 400 })

  const { data: prof, error: profErr } = await supabase.from('users').select('name, see_all_orders').eq('id', user.id).maybeSingle()
  if (profErr) return NextResponse.json({ error: `Профиль не прочитан: ${profErr.message}` }, { status: 500 })
  const who = (prof as { name: string | null } | null)?.name ?? user.email ?? 'Менеджер'
  // Как на «Мой день · B2B»: менеджер закрывает свои заказы, владелец и «видит все» — любые.
  const seeAll = isOwnerRole(role) || (prof as { see_all_orders?: boolean } | null)?.see_all_orders === true

  const svc = createServiceClient()
  const ids = [...new Set(items.map(i => i.order_id))]
  const { data: rows, error: readErr } = await svc.from('b2b_orders')
    .select('id, client_id, custom_number, notes, launched_at, created_at, created_by, archived_at')
    .in('id', ids)
  if (readErr) return NextResponse.json({ error: `Заказы не прочитаны: ${readErr.message}` }, { status: 500 })
  const byId = new Map((rows ?? []).map(r => [r.id as number, r]))

  const clientIds = [...new Set((rows ?? []).map(r => r.client_id as number | null).filter((x): x is number => !!x))]
  const { data: clients, error: cErr } = clientIds.length
    ? await svc.from('b2b_clients').select('id, user_id').in('id', clientIds)
    : { data: [], error: null }
  if (cErr) return NextResponse.json({ error: `Клиенты не прочитаны: ${cErr.message}` }, { status: 500 })
  const partnerClient = new Set((clients ?? []).filter(c => c.user_id).map(c => c.id as number))

  const today = mskDayKey()
  const nowIso = new Date().toISOString()
  const done: number[] = []
  const skipped: Skipped[] = []

  for (const it of items) {
    const o = byId.get(it.order_id)
    if (!o) { skipped.push({ order_id: it.order_id, reason: 'заказ не найден' }); continue }
    if (o.archived_at) { skipped.push({ order_id: it.order_id, reason: 'заказ в архиве' }); continue }
    if (!seeAll && o.created_by !== user.id) { skipped.push({ order_id: it.order_id, reason: 'заказ другого менеджера' }); continue }
    const n = parseNotes(o.notes as string | null)
    if (!isLaunched(o as unknown as TodayOrder, n)) { skipped.push({ order_id: it.order_id, reason: 'заказ не запущен' }); continue }
    if (isShipped(n)) { skipped.push({ order_id: it.order_id, reason: 'уже отмечен отгруженным' }); continue }
    const launchedDay = o.launched_at ? String(o.launched_at).slice(0, 10) : null
    const problem = backfillDateProblem(it.date, today, launchedDay)
    if (problem) { skipped.push({ order_id: it.order_id, reason: problem }); continue }

    // Полдень по Москве: stageDayKey отнесёт отметку ровно к выбранному дню.
    const { error: markErr } = await svc.rpc('mark_order_stages', {
      p_order_id: it.order_id,
      p_stages: { shipped: `${it.date}T12:00:00+03:00` },
    })
    if (markErr) { skipped.push({ order_id: it.order_id, reason: `не записано: ${markErr.message}` }); continue }

    // Кто и когда закрыл задним числом — чтобы отличать от отметки у машины.
    await svc.rpc('patch_order_notes_shallow', {
      p_order_id: it.order_id,
      p_patch: { ship_backfill: { by: who, at: nowIso, date: it.date } },
    })
    await svc.from('b2b_orders').update({ updated_by_name: who, updated_at: nowIso }).eq('id', it.order_id)

    if (it.date < today && o.client_id && partnerClient.has(o.client_id as number)) {
      const number = (o.custom_number as string | null)?.trim() || `#${it.order_id}`
      await svc.from('partner_notifications').upsert({
        client_id: o.client_id, order_id: it.order_id, kind: 'shipped',
        title: `Заказ отгружен · ${number}`, link: `/partner/order/${it.order_id}`,
        read_at: nowIso, emailed_at: nowIso,
      }, { onConflict: 'client_id,order_id,kind', ignoreDuplicates: true })
    }
    done.push(it.order_id)
  }

  return NextResponse.json({ ok: true, done, skipped })
}
