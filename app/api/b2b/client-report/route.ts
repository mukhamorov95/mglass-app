import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { canAccessRoute, isOwnerRole } from '@/lib/getRole'
import { launchedOrders } from '@/lib/liveOrders'
import { mskDayKey } from '@/lib/time'
import {
  buildGroups, buildNameIndex, attribute, summarize, byMonth, ranking, isDayKey, groupKeyOf, UNKNOWN_KEY,
  type ReportClientCard, type ReportEntity, type ReportOrderRow,
} from '@/lib/b2b/clientReport'

export const dynamic = 'force-dynamic'

// Отчёт по клиентам B2B: клиент × период → заказы и суммы. Читаем под RLS вошедшего,
// но RLS b2b_orders пускает любого сотрудника ко всем заказам — изоляция менеджера
// (правило 4) держится здесь: без «видит все заказы» — только свои. Маржи и
// себестоимости в ответе нет: это не CFO.

const COLS = 'id, client_id, client_name, launched_at, total_after_discount, total_sale_inc_vat, custom_number'
type Row = ReportOrderRow & { custom_number: string | null }

export async function GET(req: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Нужно войти' }, { status: 401 })
  const { data: profile, error: pErr } = await sb.from('users').select('role, see_all_orders').eq('id', user.id).maybeSingle()
  if (pErr) return NextResponse.json({ error: `Профиль не прочитан: ${pErr.message}` }, { status: 500 })
  const role = profile?.role as string | undefined
  if (!canAccessRoute(role, '/b2b-crm/report')) return NextResponse.json({ error: 'Нет доступа к отчёту' }, { status: 403 })
  const seeAll = isOwnerRole(role) || profile?.see_all_orders === true

  const sp = req.nextUrl.searchParams
  const today = mskDayKey()
  const from = isDayKey(sp.get('from')) ? sp.get('from')! : `${today.slice(0, 4)}-01-01`
  const to = isDayKey(sp.get('to')) ? sp.get('to')! : today
  if (from > to) return NextResponse.json({ error: 'Начало периода позже конца' }, { status: 400 })

  const [cardsRes, entRes] = await Promise.all([
    sb.from('b2b_clients').select('id, name'),
    sb.from('b2b_client_legal_entities').select('client_id, full_name'),
  ])
  if (cardsRes.error || entRes.error) {
    return NextResponse.json({ error: `Клиенты не прочитаны: ${(cardsRes.error ?? entRes.error)!.message}` }, { status: 500 })
  }
  const cards = (cardsRes.data ?? []) as ReportClientCard[]
  const groups = buildGroups(cards)
  const cardsById = new Map(cards.map(c => [c.id, c]))
  const nameIndex = buildNameIndex(cards, (entRes.data ?? []) as ReportEntity[])

  // Клиент задаётся карточкой (?client=10 — ссылка из карточки) или ключом группы
  // (?g=… — строка рейтинга, в том числе имя без карточки).
  const clientId = Number(sp.get('client'))
  const card = Number.isInteger(clientId) ? cardsById.get(clientId) : undefined
  const g = card ? groupKeyOf(card.name) : (sp.get('g') || null)

  const rows: Row[] = []
  for (let off = 0; ; off += 1000) {
    let q = launchedOrders(sb, COLS).gte('launched_at', from).lte('launched_at', to)
      .order('launched_at', { ascending: false }).order('id', { ascending: false }).range(off, off + 999)
    if (!seeAll) q = q.eq('created_by', user.id)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: `Заказы не прочитаны: ${error.message}` }, { status: 500 })
    const page = (data ?? []) as unknown as Row[]
    rows.push(...page)
    if (page.length < 1000) break
  }
  const attributed = rows.map(r => attribute(r, cardsById, nameIndex))

  // Менеджеру без «видит все» — только клиенты из его заказов: чужую клиентскую базу
  // списком не отдаём.
  const present = new Set(attributed.map(r => r.groupKey))
  const groupList = [...groups.values()]
    .filter(x => seeAll || present.has(x.key))
    .map(x => ({ key: x.key, label: x.label, ownRetail: x.ownRetail, merged: x.cardIds.length }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  const base = { period: { from, to }, seeAll, groups: groupList }

  if (!g) {
    return NextResponse.json({
      ...base,
      summary: summarize(attributed),
      byNameCount: attributed.filter(r => r.byName).length,
      ranking: ranking(attributed, groups),
    })
  }

  if (!seeAll && !present.has(g)) {
    return NextResponse.json({ ...base, client: null, notice: 'За этот период ваших заказов у этого клиента нет' })
  }
  const mine = attributed.filter(r => r.groupKey === g)
  const group = groups.get(g)
  // Отгрузка — отметка стадии в notes; история 2024–2025 — импорт без стадий.
  // Читаем только для заказов этого клиента.
  const shipped = new Set<number>()
  const historical = new Set<number>()
  for (let i = 0; i < mine.length; i += 200) {
    const ids = mine.slice(i, i + 200).map(r => r.id)
    const { data, error } = await sb.from('b2b_orders').select('id, notes').in('id', ids)
    if (error) return NextResponse.json({ error: `Отметки отгрузки не прочитаны: ${error.message}` }, { status: 500 })
    for (const r of (data ?? []) as { id: number; notes: string | null }[]) {
      try {
        const n = JSON.parse(r.notes ?? '{}')
        if (n?.stages?.shipped) shipped.add(r.id)
        if (n?.historical === true) historical.add(r.id)
      } catch { /* notes не JSON — отметки нет */ }
    }
  }

  return NextResponse.json({
    ...base,
    client: {
      key: g,
      label: group?.label ?? (g === UNKNOWN_KEY ? 'Клиент не указан' : (mine[0]?.client_name ?? '').trim() || g.slice(2)),
      hasCard: !!group,
      ownRetail: group?.ownRetail ?? false,
      cards: group ? group.cardIds.map(id => ({ id, name: cardsById.get(id)?.name ?? '' })) : [],
    },
    summary: summarize(mine),
    months: byMonth(mine),
    byNameCount: mine.filter(r => r.byName).length,
    orders: mine.map(r => ({
      id: r.id,
      number: r.custom_number || `#${r.id}`,
      launchedAt: r.launched_at,
      amount: r.amount,
      byName: r.byName,
      shipped: shipped.has(r.id),
      historical: historical.has(r.id),
      clientName: r.client_name,
    })),
  })
}
