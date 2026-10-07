// Выдача УПД — одна для менеджера (/api/quotes/[id]/upd-issue) и бухгалтера
// (/api/accounting/upd/[orderId], этап 8б docs/b2b/ORDER_PANEL_ROUTE.md). Документ собирает
// сервер из заказа и выбранного юрлица и сохраняет как есть: клиенту не доверяем ни строки,
// ни суммы, ни покупателя. Доступ к заказу проверяет вызывающий маршрут.

import type { SupabaseClient } from '@supabase/supabase-js'
import { writeLogForCurrentUser } from '@/lib/activityLog'
import { parseNotes } from '@/lib/b2b/publicQuote'
import type { InvoiceOrder, InvoiceRequisites } from '@/lib/b2b/invoiceMath'
import { buildUpdBody, moscowDate, updDateError, updIssueBlockers, type UpdBody } from '@/lib/b2b/updView'
import { issueUpd, loadUpdIssued } from '@/lib/b2b/updRegistry'

export const UPD_ORDER_COLS =
  'id,client_id,client_name,custom_number,discount_percent,items,total_sale_inc_vat,total_after_discount,notes,created_at,launched_at,archived_at'

export type UpdOrder = InvoiceOrder & {
  client_id: number | null
  client_name: string | null
  launched_at?: string | null
  archived_at?: string | null
}

const REQ_COLS = 'full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date'

type Fail = { ok: false; status: number; error: string }

// Покупатель — юрлицо этого же клиента; чужое юрлицо подставить нельзя. Без юрлица —
// плоские реквизиты карточки клиента.
export async function resolveUpdBuyer(
  svc: SupabaseClient, order: Pick<UpdOrder, 'client_id' | 'client_name'>, entityId: number | null,
): Promise<{ ok: true; req: InvoiceRequisites; buyerName: string } | Fail> {
  let requisites: Record<string, unknown> | null = null
  if (entityId != null) {
    if (!Number.isFinite(entityId) || order.client_id == null) return { ok: false, status: 404, error: 'Юрлицо не найдено' }
    const { data: ent } = await svc.from('b2b_client_legal_entities').select(`client_id,active,${REQ_COLS}`).eq('id', entityId).maybeSingle()
    if (!ent || ent.client_id !== order.client_id || !ent.active) return { ok: false, status: 404, error: 'Юрлицо не найдено' }
    requisites = ent
  }
  const { data: clientRow } = order.client_id != null
    ? await svc.from('b2b_clients').select(`name,${REQ_COLS}`).eq('id', order.client_id).maybeSingle()
    : { data: null }
  if (entityId == null) requisites = clientRow ?? null
  const s = (k: string) => (requisites?.[k] as string | null | undefined) ?? ''
  const req: InvoiceRequisites = {
    full_name: s('full_name'), inn: s('inn'), kpp: s('kpp'), ogrn: s('ogrn'), legal_address: s('legal_address'),
    bank_account: s('bank_account'), bank_name: s('bank_name'), bik: s('bik'), corr_account: s('corr_account'),
    supply_contract_no: s('supply_contract_no'), supply_contract_date: s('supply_contract_date'),
  }
  return { ok: true, req, buyerName: order.client_name || (clientRow?.name as string | null) || '' }
}

export async function buildUpdForOrder(
  svc: SupabaseClient, order: UpdOrder, entityId: number | null, docDate: string,
): Promise<{ ok: true; body: UpdBody } | Fail> {
  const buyer = await resolveUpdBuyer(svc, order, entityId)
  if (!buyer.ok) return buyer
  return { ok: true, body: buildUpdBody(order, buyer.req, buyer.buyerName, docDate) }
}

// Запущен и не в архиве. Колонки читаем сами: у вызывающего маршрута их может не быть.
export async function updOrderState(svc: SupabaseClient, order: Pick<UpdOrder, 'id' | 'notes'>): Promise<{ launched: boolean; archived: boolean }> {
  const { data } = await svc.from('b2b_orders').select('launched_at, archived_at').eq('id', order.id).maybeSingle()
  return { launched: !!data?.launched_at || !!parseNotes(order.notes).launched_at, archived: !!data?.archived_at }
}

export async function issueUpdForOrder(
  svc: SupabaseClient, order: UpdOrder,
  input: { docDate: string; entityId: number | null },
  user: { id: string; email?: string | null },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { docDate, entityId } = input
  const already = await loadUpdIssued(svc, order.id)
  if (already) return { status: 200, json: { issued: already, already: true } }

  const dateErr = updDateError(docDate, order.created_at, moscowDate())
  if (dateErr) return { status: 400, json: { error: `Дата УПД: ${dateErr}` } }

  const state = await updOrderState(svc, order)
  if (!state.launched) return { status: 409, json: { error: 'УПД выдаётся по запущенному заказу — сейчас это просчёт' } }
  if (state.archived) return { status: 409, json: { error: 'Заказ в архиве — УПД по нему не выдаётся' } }

  const built = await buildUpdForOrder(svc, order, entityId, docDate)
  if (!built.ok) return { status: built.status, json: { error: built.error } }
  const body = built.body
  const blockers = updIssueBlockers(body)
  if (blockers.length) return { status: 400, json: { error: `УПД не выдан: ${blockers.join(', ')}` } }

  const { data: prof } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
  const out = await issueUpd(svc, { orderId: order.id, docDate, entityId, body, by: { id: user.id, name: (prof?.name as string | null) ?? user.email ?? null } })
  if (!out.ok) {
    return {
      status: 409,
      json: {
        code: out.code,
        error: out.code === 'pending_sql'
          ? 'Выдача УПД включится после SQL владельца (20261007_upd_registry.sql)'
          : `Нумерация УПД на ${out.year} год не включена: бухгалтер задаёт первый номер в «Бухгалтерия → УПД»`,
      },
    }
  }
  await writeLogForCurrentUser('upd.issue', {
    entityType: 'b2b_order', entityId: String(order.id),
    details: { number: out.issued.number, year: out.issued.year, doc_date: out.issued.doc_date, sum_inc_vat: body.totals.sumIncVat, buyer_inn: body.buyer.inn, entity_id: entityId },
  })
  return { status: 200, json: { issued: out.issued, already: false } }
}

export function parseEntityId(v: unknown): number | null {
  return v == null || v === '' ? null : Number(v)
}
