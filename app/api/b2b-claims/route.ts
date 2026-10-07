import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { missingSchema } from '@/lib/b2b/updRegistry'
import { chunk, readPaged } from '@/lib/partner/readPaged'
import { CLAIM_KIND_LABEL, isClosed, parseClaimPatch } from '@/lib/partner/claims'

// Очередь гарантийных обращений партнёров — только владельцам. Читает и пишет
// partner_claims сервис-ключом (у таблицы RLS без политик); партнёр видит новый статус
// и ответ у себя в /partner/claims при заходе — уведомлений не шлём.

export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>
const BASE_COLS = 'id, client_id, order_id, kind, description, status, resolution, created_at, resolved_at'

// Колонка cause появляется после SQL 20261008_partner_claims_cause.sql; до него — без неё.
async function readClaims(svc: ReturnType<typeof createServiceClient>): Promise<{ rows: Row[]; causeReady: boolean }> {
  try {
    const rows = await readPaged<Row>(() => svc.from('partner_claims').select(`${BASE_COLS}, cause`).order('id', { ascending: false }))
    return { rows, causeReady: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!missingSchema({ message })) throw e
    const rows = await readPaged<Row>(() => svc.from('partner_claims').select(BASE_COLS).order('id', { ascending: false }))
    return { rows, causeReady: false }
  }
}

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const svc = createServiceClient()

  try {
    const { rows, causeReady } = await readClaims(svc)
    const clientIds = [...new Set(rows.map(r => Number(r.client_id)).filter(Boolean))]
    const orderIds = [...new Set(rows.map(r => Number(r.order_id)).filter(Boolean))]
    const [clients, orders] = await Promise.all([
      Promise.all(chunk(clientIds, 500).map(part => readPaged<Row>(() => svc.from('b2b_clients').select('id, name, is_point').in('id', part).order('id')))).then(x => x.flat()),
      Promise.all(chunk(orderIds, 500).map(part => readPaged<Row>(() => svc.from('b2b_orders').select('id, custom_number').in('id', part).order('id')))).then(x => x.flat()),
    ])
    const clientBy = new Map(clients.map(c => [Number(c.id), c]))
    const orderBy = new Map(orders.map(o => [Number(o.id), o]))

    const claims = rows.map(r => {
      const c = clientBy.get(Number(r.client_id))
      const o = r.order_id ? orderBy.get(Number(r.order_id)) : null
      return {
        id: Number(r.id),
        clientId: Number(r.client_id),
        clientName: (c?.name as string | undefined) ?? `Клиент #${r.client_id}`,
        isPoint: c?.is_point === true,
        orderId: r.order_id ? Number(r.order_id) : null,
        orderNumber: r.order_id ? ((o?.custom_number as string | null | undefined)?.trim() || `#${r.order_id}`) : null,
        kind: String(r.kind),
        kindLabel: CLAIM_KIND_LABEL[String(r.kind)] ?? String(r.kind),
        description: String(r.description ?? ''),
        status: String(r.status),
        resolution: (r.resolution as string | null) ?? null,
        cause: causeReady ? ((r.cause as string | null) ?? null) : null,
        createdAt: String(r.created_at),
        resolvedAt: (r.resolved_at as string | null) ?? null,
      }
    })
    return NextResponse.json({ claims, causeReady }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: `Обращения не загрузились: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const parsed = parseClaimPatch(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { id, patch } = parsed
  const svc = createServiceClient()

  const update: Row = {
    status: patch.status,
    resolution: patch.resolution,
    resolved_at: isClosed(patch.status) ? new Date().toISOString() : null,
  }
  if (patch.cause !== undefined) update.cause = patch.cause

  const { data, error } = await svc.from('partner_claims').update(update).eq('id', id).select('id, status, resolution, resolved_at')
  if (error) {
    if (patch.cause !== undefined && missingSchema(error)) {
      return NextResponse.json({ error: 'Причина сохранится после SQL владельца (supabase/migrations/20261008_partner_claims_cause.sql). Сохраните без причины' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data || data.length === 0) return NextResponse.json({ error: 'Обращение не найдено' }, { status: 404 })
  return NextResponse.json({ ok: true, claim: data[0] })
}
