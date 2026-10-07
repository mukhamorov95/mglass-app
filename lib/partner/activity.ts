import { stagesOf, stageDate } from '@/lib/b2b/stageDone'
import { partnerProgress, noteStatus } from '@/lib/partner/orderProgress'
import { decisionOf } from '@/lib/partner/drawingApproval'
import { POINT_LINE, type PointStage } from '@/lib/partner/pointPay'

// Табло кабинета: что на самом деле произошло с заказами (по датам отметок, оплат и
// документов) и что ждёт партнёра. Состояние на экране — никаких рассылок.

export type ActivityOrder = {
  id: number
  number: string
  created_at: string
  launched_at: string | null
  notes: Record<string, unknown>
}

export type ActivityEvent = { at: string; orderId: number; number: string; text: string; tone: 'done' | 'money' | 'doc' | 'info' }
export type PaymentEvent = { orderId: number; amount: number; paidAt: string }
export type DocEvent = { orderId: number; at: string; text: string }

const STEP_TEXT: [string, string][] = [
  ['cut', 'Резка выполнена'],
  ['edge_processed', 'Кромка обработана'],
  ['drilled', 'Сверление выполнено'],
  ['tempering', 'Закалка выполнена'],
  ['packaged', 'Упакован — готов к выдаче'],
  ['shipped', 'Отгружен'],
]

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const valid = (s: unknown): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s))

export function buildEvents(
  orders: ActivityOrder[],
  payments: PaymentEvent[],
  docs: DocEvent[],
  limit = 8,
): ActivityEvent[] {
  const out: ActivityEvent[] = []
  const numberOf = new Map(orders.map(o => [o.id, o.number]))
  for (const o of orders) {
    const n = o.notes
    const push = (at: unknown, text: string, tone: ActivityEvent['tone']) => {
      if (valid(at)) out.push({ at, orderId: o.id, number: o.number, text, tone })
    }
    push(n.submitted_by_partner_at, 'Вы отправили просчёт в работу', 'info')
    push(o.launched_at ?? n.launched_at, 'Запущен в работу', 'info')
    const st = stagesOf(n)
    for (const [key, text] of STEP_TEXT) push(stageDate(st, key), text, 'done')
    // Решения менеджера по просчёту — из истории статусов (дата и куда перевели).
    for (const h of Array.isArray(n.status_history) ? n.status_history as Record<string, unknown>[] : []) {
      if (h?.by === 'partner') continue
      if (h?.to === 'agreed') push(h.date, 'Менеджер согласовал просчёт', 'info')
      if (h?.to === 'rejected') push(h.date, 'Менеджер отклонил просчёт', 'info')
    }
    const d = decisionOf(n.drawing_approval)
    if (d) push(d.at, d.status === 'approved' ? 'Вы согласовали чертёж' : 'Вы отправили чертёж на доработку', 'info')
  }
  for (const p of payments) {
    const number = numberOf.get(p.orderId)
    if (number && valid(p.paidAt)) out.push({ at: p.paidAt, orderId: p.orderId, number, text: `Получена оплата ${rub(p.amount)}`, tone: 'money' })
  }
  for (const e of docs) {
    const number = numberOf.get(e.orderId)
    if (number && valid(e.at)) out.push({ at: e.at, orderId: e.orderId, number, text: e.text, tone: 'doc' })
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit)
}

export type WaitingKind = 'drawing' | 'payment' | 'delivery'
export type WaitingAction = { kind: WaitingKind; orderId: number; number: string; text: string }

// Старше — почти всегда отгружено без отметки (на 07.10 таких 78 упакованных): спрашивать
// партнёра про доставку и чертёж давно уехавшего заказа — шум.
export const WAITING_RECENT_DAYS = 45

// Что ждёт партнёра. drawingOpen — у заказа есть чертёж без действующего решения
// (решение устарело — считает вызывающий по времени файла).
export function waitingActions(
  orders: ActivityOrder[],
  opts: { drawingOpen: (o: ActivityOrder) => boolean; point: (o: ActivityOrder) => PointStage | null; now?: number },
): WaitingAction[] {
  const now = opts.now ?? Date.now()
  const out: WaitingAction[] = []
  for (const o of orders) {
    const n = o.notes
    if (n.is_template === true) continue
    const p = partnerProgress({ launched_at: o.launched_at }, n)
    if (p.lane === 'shipped') continue
    const status = noteStatus(n)
    if (status === 'rejected' || status === 'cancelled') continue
    const since = Date.parse(String(o.launched_at ?? n.launched_at ?? o.created_at))
    const recent = Number.isFinite(since) && (now - since) / 86_400_000 <= WAITING_RECENT_DAYS

    // Чертёж согласуют до производства: когда цех уже режет, спрашивать поздно.
    if (recent && p.progressPct === 0 && !p.ready && opts.drawingOpen(o)) {
      out.push({ kind: 'drawing', orderId: o.id, number: o.number, text: 'Чертёж ждёт согласования' })
    }
    if (opts.point(o) === 'await_payment') {
      out.push({ kind: 'payment', orderId: o.id, number: o.number, text: POINT_LINE.await_payment })
    }
    const dl = n.delivery as { method?: unknown } | undefined
    if (recent && p.lane === 'in_work' && !(dl && (dl.method === 'pickup' || dl.method === 'delivery'))) {
      out.push({ kind: 'delivery', orderId: o.id, number: o.number, text: p.ready ? 'Готов — выберите доставку или самовывоз' : 'Не выбран способ получения' })
    }
  }
  const rank: Record<WaitingKind, number> = { payment: 0, drawing: 1, delivery: 2 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.orderId - a.orderId)
}
