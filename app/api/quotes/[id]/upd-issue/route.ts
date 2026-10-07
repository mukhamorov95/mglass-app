import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { writeLogForCurrentUser } from '@/lib/activityLog'
import { loadOrderWithAccess } from '@/lib/b2bOrderAccess'
import { parseNotes } from '@/lib/b2b/publicQuote'
import type { InvoiceOrder, InvoiceRequisites } from '@/lib/b2b/invoiceMath'
import { buildUpdBody, moscowDate, updDateError, updIssueBlockers } from '@/lib/b2b/updView'
import { issueUpd, loadUpdIssued, loadUpdSeries } from '@/lib/b2b/updRegistry'

// Выдача УПД из приложения (этап 7 docs/b2b/ORDER_PANEL_ROUTE.md). Номер — из серии, которую
// задаёт бухгалтер; содержимое документа собирает сервер из заказа и выбранного юрлица и
// сохраняет как есть: клиенту не доверяем ни строки, ни суммы, ни покупателя.
const UPD_ISSUERS = new Set(['admin', 'ceo', 'manager', 'accountant', 'cfo'])

const REQ_COLS = 'full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date'

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
  const docDate = String(body.doc_date ?? '')
  const entityId = body.entity_id == null || body.entity_id === '' ? null : Number(body.entity_id)

  const svc = createServiceClient()
  const orderId = order.id as number
  const already = await loadUpdIssued(svc, orderId)
  if (already) return NextResponse.json({ issued: already, already: true })

  const dateErr = updDateError(docDate, order.created_at as string, moscowDate())
  if (dateErr) return NextResponse.json({ error: `Дата УПД: ${dateErr}` }, { status: 400 })

  const notes = parseNotes(order.notes as string | null)
  const { data: lr } = await svc.from('b2b_orders').select('launched_at').eq('id', orderId).maybeSingle()
  if (!lr?.launched_at && !notes.launched_at) {
    return NextResponse.json({ error: 'УПД выдаётся по запущенному заказу — сейчас это просчёт' }, { status: 409 })
  }

  // Покупатель — юрлицо этого же клиента; чужое юрлицо подставить нельзя.
  let requisites: Record<string, unknown> | null = null
  if (entityId != null) {
    if (!Number.isFinite(entityId) || order.client_id == null) return NextResponse.json({ error: 'Юрлицо не найдено' }, { status: 404 })
    const { data: ent } = await svc.from('b2b_client_legal_entities').select(`client_id,active,${REQ_COLS}`).eq('id', entityId).maybeSingle()
    if (!ent || ent.client_id !== order.client_id || !ent.active) return NextResponse.json({ error: 'Юрлицо не найдено' }, { status: 404 })
    requisites = ent
  } else if (order.client_id != null) {
    const { data: cl } = await svc.from('b2b_clients').select(`name,${REQ_COLS}`).eq('id', order.client_id).maybeSingle()
    requisites = cl ?? null
  }
  const { data: clientRow } = order.client_id != null
    ? await svc.from('b2b_clients').select('name').eq('id', order.client_id).maybeSingle()
    : { data: null }
  const s = (k: string) => (requisites?.[k] as string | null | undefined) ?? ''
  const req2: InvoiceRequisites = {
    full_name: s('full_name'), inn: s('inn'), kpp: s('kpp'), ogrn: s('ogrn'), legal_address: s('legal_address'),
    bank_account: s('bank_account'), bank_name: s('bank_name'), bik: s('bik'), corr_account: s('corr_account'),
    supply_contract_no: s('supply_contract_no'), supply_contract_date: s('supply_contract_date'),
  }
  const buyerName = (order.client_name as string | null) || (clientRow?.name as string | null) || ''
  const updBody = buildUpdBody(order as unknown as InvoiceOrder, req2, buyerName, docDate)
  const blockers = updIssueBlockers(updBody)
  if (blockers.length) return NextResponse.json({ error: `УПД не выдан: ${blockers.join(', ')}` }, { status: 400 })

  const { data: prof } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
  try {
    const out = await issueUpd(svc, { orderId, docDate, entityId, body: updBody, by: { id: user.id, name: (prof?.name as string | null) ?? user.email ?? null } })
    if (!out.ok) {
      return NextResponse.json({
        code: out.code,
        error: out.code === 'pending_sql'
          ? 'Выдача УПД включится после SQL владельца (20261007_upd_registry.sql)'
          : `Нумерация УПД на ${out.year} год не включена: бухгалтер задаёт первый номер в «Бухгалтерия → УПД»`,
      }, { status: 409 })
    }
    await writeLogForCurrentUser('upd.issue', {
      entityType: 'b2b_order', entityId: String(orderId),
      details: { number: out.issued.number, year: out.issued.year, doc_date: out.issued.doc_date, sum_inc_vat: updBody.totals.sumIncVat, buyer_inn: updBody.buyer.inn, entity_id: entityId },
    })
    return NextResponse.json({ issued: out.issued, already: false })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
