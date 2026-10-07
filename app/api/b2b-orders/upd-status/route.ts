import { NextRequest, NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { getSessionUser, isOwnerRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { mskDayKey } from '@/lib/time'
import { loadUpdSeries, missingSchema } from '@/lib/b2b/updRegistry'
import type { UpdIssuedShort, UpdStatus } from '@/lib/b2b/updStatus'

export const dynamic = 'force-dynamic'

// УПД у заказов в /b2b-orders (этап 9 docs/b2b/ORDER_PANEL_ROUTE.md): номер выданного, нужен ли
// УПД (у клиента есть ИНН) и включена ли серия. Реестр закрыт RLS — читаем сервисом, но только
// по заказам, которые этот человек видит в списке: менеджер без «видит все» — по своим.
export async function GET(req: NextRequest) {
  const guard = await requirePageAccess('/b2b-orders')
  if (guard instanceof NextResponse) return guard
  const role = guard
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Нужно войти' }, { status: 401 })

  const ids = (req.nextUrl.searchParams.get('ids') ?? '')
    .split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 2000)
  const svc = createServiceClient()
  const empty: UpdStatus = { issued: {}, eligible: [], series: { pendingSql: false, set: false } }
  if (!ids.length) return NextResponse.json(empty)

  try {
    const { data: prof } = await svc.from('users').select('see_all_orders').eq('id', user.id).maybeSingle()
    const seesAll = isOwnerRole(role) || role === 'buyer' || prof?.see_all_orders === true
    // Пачками по 500: PostgREST отдаёт не больше 1000 строк, а заказов у владельца больше.
    const parts = chunk(ids, 500)
    const orderRes = await Promise.all(parts.map(part => {
      let q = svc.from('b2b_orders').select('id, client_id').in('id', part)
      if (!seesAll) q = q.eq('created_by', user.id)
      return q
    }))
    const oErr = orderRes.find(r => r.error)?.error
    if (oErr) throw new Error(oErr.message)
    const visible = orderRes.flatMap(r => (r.data ?? []) as { id: number; client_id: number | null }[])
    const visibleIds = visible.map(o => o.id)
    if (!visibleIds.length) return NextResponse.json(empty)

    const clientIds = [...new Set(visible.map(o => o.client_id).filter((x): x is number => x != null))]
    const [regParts, series, clients, entities] = await Promise.all([
      Promise.all(chunk(visibleIds, 500).map(part =>
        svc.from('upd_registry').select('b2b_order_id, number, year, doc_date').in('b2b_order_id', part))),
      loadUpdSeries(svc),
      clientIds.length ? svc.from('b2b_clients').select('id').in('id', clientIds).neq('inn', '') : Promise.resolve({ data: [], error: null }),
      clientIds.length ? svc.from('b2b_client_legal_entities').select('client_id').in('client_id', clientIds).eq('active', true).neq('inn', '') : Promise.resolve({ data: [], error: null }),
    ])
    const regErr = regParts.find(r => r.error)?.error ?? null
    const pendingSql = series === null || (!!regErr && missingSchema(regErr))
    if (regErr && !pendingSql) throw new Error(regErr.message)
    const cErr = clients.error ?? entities.error
    if (cErr) throw new Error(cErr.message)

    const issued: Record<number, UpdIssuedShort> = {}
    if (!pendingSql) {
      for (const r of regParts.flatMap(p => (p.data ?? []) as { b2b_order_id: number; number: number; year: number; doc_date: string }[])) {
        issued[r.b2b_order_id] = { number: r.number, year: r.year, doc_date: r.doc_date }
      }
    }
    const innClients = new Set([
      ...((clients.data ?? []) as { id: number }[]).map(c => c.id),
      ...((entities.data ?? []) as { client_id: number }[]).map(e => e.client_id),
    ])
    const year = Number(mskDayKey().slice(0, 4))
    const out: UpdStatus = {
      issued,
      eligible: visible.filter(o => o.client_id != null && innClients.has(o.client_id)).map(o => o.id),
      series: { pendingSql, set: !!series?.some(s => s.year === year) },
    }
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
