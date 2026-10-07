import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { loadOrderWithAccess } from '@/lib/b2bOrderAccess'
import { loadUpdIssued, loadUpdSeries } from '@/lib/b2b/updRegistry'
import { issueUpdForOrder, parseEntityId, type UpdOrder } from '@/lib/b2b/updIssue'

// Выдача УПД из приложения (этап 7 docs/b2b/ORDER_PANEL_ROUTE.md). Номер — из серии, которую
// задаёт бухгалтер. Сама выдача — lib/b2b/updIssue.ts, общая с «Бухгалтерия → УПД» (этап 8б).
// Бухгалтеру /b2b-quotes закрыт, поэтому здесь он получает 403 и выдаёт из своего раздела.
const UPD_ISSUERS = new Set(['admin', 'ceo', 'manager', 'accountant', 'cfo'])

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await loadOrderWithAccess(id)
  if (res.status !== 200) return NextResponse.json({ error: res.error }, { status: res.status })
  const svc = createServiceClient()
  const [issued, series] = await Promise.all([loadUpdIssued(svc, res.order.id as number), loadUpdSeries(svc)])
  return NextResponse.json({ issued, series: series ?? [], pendingSql: series === null, canIssue: !!res.role && UPD_ISSUERS.has(res.role) })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await loadOrderWithAccess(id)
  if (res.status !== 200) return NextResponse.json({ error: res.error }, { status: res.status })
  const { order, user, role } = res
  if (!role || !UPD_ISSUERS.has(role)) {
    return NextResponse.json({ error: 'Выдать УПД может менеджер, бухгалтерия или владелец' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { doc_date?: unknown; entity_id?: unknown }
  try {
    const out = await issueUpdForOrder(createServiceClient(), order as unknown as UpdOrder,
      { docDate: String(body.doc_date ?? ''), entityId: parseEntityId(body.entity_id) }, user)
    return NextResponse.json(out.json, { status: out.status })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
