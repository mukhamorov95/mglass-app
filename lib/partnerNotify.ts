import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyPartnerOrderStatus } from '@/lib/notify'

// Оркестрация уведомлений кабинета партнёра: колокольчик (partner_notifications)
// + e-mail (Resend, best-effort). Идемпотентность — уникальный индекс
// (client_id, order_id, kind): одно событие каждого типа на заказ. E-mail шлём
// только когда реально вставили новую строку. Исторические заказы не «выстреливают»:
// смотрим только свежие транзиции (RECENT_DAYS по времени этапа/запуска).

const RECENT_DAYS = 45
const isRecent = (iso: string | null | undefined): boolean =>
  !!iso && (Date.now() - new Date(iso).getTime()) / 86_400_000 <= RECENT_DAYS

export type NotifyKind = 'access' | 'submitted' | 'in_work' | 'ready' | 'shipped' | 'recalc' | 'drawing_approved' | 'drawing_rework' | 'claim' | 'claim_update'

function parseNotes(n: unknown): Record<string, unknown> {
  if (!n) return {}
  if (typeof n === 'object') return n as Record<string, unknown>
  try { const p = JSON.parse(n as string); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}

// Вставка одного уведомления. Дубликат (тот же client/order/kind) молча игнорируется.
// Возвращает true, если это НОВОЕ событие (значит, можно слать письмо).
export async function pushNotification(svc: SupabaseClient, n: {
  clientId: number; orderId?: number | null; kind: NotifyKind; title: string; body?: string; link?: string
}): Promise<boolean> {
  const row = {
    client_id: n.clientId, order_id: n.orderId ?? null, kind: n.kind,
    title: n.title, body: n.body ?? null, link: n.link ?? null,
  }
  const { data } = await svc
    .from('partner_notifications')
    .upsert(row, { onConflict: 'client_id,order_id,kind', ignoreDuplicates: true })
    .select('id')
  return Array.isArray(data) && data.length > 0
}

// Текущий «этап» заказа и время его достижения — та же модель, что видит партнёр.
function orderTransitions(o: Record<string, unknown>): { kind: 'in_work' | 'ready' | 'shipped'; ts: string | null }[] {
  const pn = parseNotes(o.notes)
  const stages = (pn.stages ?? {}) as Record<string, unknown>
  const launched = (o.launched_at as string | null) || (pn.launched_at as string | null) || null
  const shippedFlag = stages.shipped
  const packedFlag = stages.packed ?? stages.packaged
  const asTs = (v: unknown): string | null => typeof v === 'string' ? v : v === true ? (o.updated_at as string | null) ?? null : null

  const out: { kind: 'in_work' | 'ready' | 'shipped'; ts: string | null }[] = []
  if (launched) out.push({ kind: 'in_work', ts: launched })
  if (packedFlag && !shippedFlag) out.push({ kind: 'ready', ts: asTs(packedFlag) })
  if (shippedFlag) out.push({ kind: 'shipped', ts: asTs(shippedFlag) })
  return out
}

const TITLE: Record<'in_work' | 'ready' | 'shipped', string> = {
  in_work: 'Заказ принят в работу',
  ready: 'Заказ готов к выдаче',
  shipped: 'Заказ отгружен',
}

// Сверить один заказ и разослать новые транзиции (bell + email). Best-effort.
export async function reconcileOrder(
  svc: SupabaseClient,
  order: Record<string, unknown>,
  client: { id: number; name: string },
  partnerEmail: string | null,
): Promise<void> {
  const orderId = order.id as number
  const number = (order.custom_number as string | null)?.trim() || `#${orderId}`
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const link = `${base}/partner/order/${orderId}`

  for (const t of orderTransitions(order)) {
    if (!isRecent(t.ts)) continue
    const fresh = await pushNotification(svc, {
      clientId: client.id, orderId, kind: t.kind,
      title: `${TITLE[t.kind]} · ${number}`, link: `/partner/order/${orderId}`,
    })
    if (fresh && partnerEmail) {
      const ok = await notifyPartnerOrderStatus({ to: partnerEmail, clientName: client.name, orderNumber: number, kind: t.kind, link })
      if (ok) await svc.from('partner_notifications')
        .update({ emailed_at: new Date().toISOString() })
        .eq('client_id', client.id).eq('order_id', orderId).eq('kind', t.kind)
    }
  }
}

// e-mail привязанного к клиенту партнёра (из public.users по b2b_clients.user_id).
export async function partnerEmailForClient(svc: SupabaseClient, userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await svc.from('users').select('email').eq('id', userId).maybeSingle()
  return (data?.email as string | null) ?? null
}

// Сверить все свежие заказы одного клиента (для колокольчика при открытии кабинета).
export async function reconcileClientOrders(svc: SupabaseClient, client: { id: number; name: string; user_id: string | null }): Promise<void> {
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString()
  const { data } = await svc
    .from('b2b_orders')
    .select('id,custom_number,launched_at,updated_at,notes')
    .eq('client_id', client.id)
    .or(`launched_at.gte.${since},updated_at.gte.${since}`)
    .limit(100)
  if (!data || data.length === 0) return
  const email = await partnerEmailForClient(svc, client.user_id)
  for (const o of data) await reconcileOrder(svc, o as Record<string, unknown>, client, email)
}
