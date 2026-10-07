// b2b_orders.notes — общий объект многих писателей: этапы цеха, оплата, доставка, ответ
// клиента по ссылке, согласование цены, сама ссылка. Экран, который пишет его целиком
// из копии, прочитанной при открытии вкладки, стирает всё, что записали за это время
// (30.09: запуск, статус, печать КП, воронка). Поэтому экраны шлют только намерение, а
// сервер собирает патч из СВЕЖИХ notes и пишет его patch_order_notes_shallow.
// Удалить ключ патч не умеет — пишем null: читатели проверяют истинность.

export type Notes = Record<string, unknown>

export function parseOrderNotes(notes: unknown): Notes {
  if (notes == null || notes === '') return {}
  if (typeof notes === 'object') return Array.isArray(notes) ? {} : notes as Notes
  try {
    const n = JSON.parse(String(notes))
    return n && typeof n === 'object' && !Array.isArray(n) ? n as Notes : {}
  } catch { return {} }
}

// Статусы обоих экранов: список просчётов и воронка (владелец).
export const ORDER_STATUSES = [
  'quote', 'sent', 'negotiation', 'agreed', 'confirmed', 'rejected',
  'in_production', 'completed', 'cancelled',
] as const
export type OrderStatus = typeof ORDER_STATUSES[number]
export const isOrderStatus = (s: unknown): s is OrderStatus =>
  typeof s === 'string' && (ORDER_STATUSES as readonly string[]).includes(s)

// Дописываем к свежему массиву, а не к тому, что был у вкладки.
export function appendTo(fresh: Notes, key: string, entry: unknown): unknown[] {
  const prev = fresh[key]
  return [...(Array.isArray(prev) ? prev : []), entry]
}

const currentStatus = (fresh: Notes) => (typeof fresh.status === 'string' && fresh.status) || 'quote'

export function statusPatch(
  fresh: Notes,
  to: OrderStatus,
  opts: { at: string; comment?: string | null; revertToDraft?: boolean },
): Notes {
  const comment = opts.comment === undefined ? undefined : (opts.comment?.trim() || null)
  return {
    status: to,
    status_history: appendTo(fresh, 'status_history', { from: currentStatus(fresh), to, date: opts.at, comment: comment ?? null }),
    ...(comment !== undefined ? { status_comment: comment } : {}),
    // Возврат в черновик снимает признак запуска — список просчётов грузит только незапущенные.
    ...(opts.revertToDraft && to === 'quote' ? { launched_at: null } : {}),
  }
}

// «В работу» с датой = запуск: дата работы и есть дата запуска.
export function launchPatch(
  fresh: Notes,
  opts: { at: string; workDate: string; deadline?: string | null; drawingUrl?: string | null },
): Notes {
  return {
    status: 'sent',
    work_started_at: opts.workDate,
    launched_at: opts.workDate,
    ...(opts.deadline ? { deadline_date: opts.deadline } : {}),
    ...(opts.drawingUrl ? { drawing_url: opts.drawingUrl } : {}),
    status_history: appendTo(fresh, 'status_history', { from: currentStatus(fresh), to: 'sent', date: opts.at, comment: null }),
  }
}

// Ключи, которые пишет только сервер: оплата — /api/b2b-orders/[id]/payment (плюс
// stages.invoice_paid там же), согласование цены и история суммы — маршруты корректировки.
// Из браузера их отбивает триггер guard_b2b_order_money (20261002_b2b_money_columns_guard.sql,
// тот же список), но сервис-ключ он пропускает — поэтому маршрут, который кладёт в patch
// ключи из тела запроса, обязан их отсеять сам.
export const SERVER_ONLY_NOTE_KEYS: readonly string[] = [
  'payment_status', 'prepayment_amount', 'paid_at', 'payments', 'price_approval', 'total_history',
]

export const KP_PAYMENT_TERMS = ['50_50', '100'] as const
export const KP_PRICE_MODES = ['consolidated', 'detailed'] as const

// Копия и «из шаблона» — новый черновик. Ключи жизни исходного заказа не переносим:
// токен ссылки (иначе отправленная клиенту ссылка перестаёт открываться — у токена
// два заказа), ответ клиента, согласование, этапы, оплату, доставку, историю.
// Список снят с живых ключей 30.09; неизвестный ключ по умолчанию остаётся — это
// содержимое просчёта (source, user_notes, production_days, price_override, КП).
export const COPY_DROP_KEYS: readonly string[] = [
  'status_history', 'status_comment', 'launched_at', 'work_started_at', 'deadline_date', 'deadline_control',
  'stages', 'detail_stages', 'detail_stage_audit', 'bulk_actions',
  'payment_status', 'paid_at', 'prepayment_amount', 'payments',
  'drawing_url', 'drawing_approval',
  'material_status', 'material_checked_by', 'material_checked_at', 'material_needed_items',
  'material_status_updated_by', 'material_status_updated_at',
  'total_history', 'price_approval', 'approved_by', 'approved_at', 'pending_approval',
  'public_token', 'share_log', 'public_opened_at', 'client_response',
  'delivery', 'claim', 'claim_history', 'ai_review', 'submitted_by_partner_at', 'updated_by_partner_at',
  'urgent', 'ship_backfill', 'shipped_date', 'docs_printed', 'docs_printed_at', 'docs_printed_by',
  'is_template', 'template_name', 'import_month', 'historical', 'month_corrected_from',
  'repeated_from',
]

export function notesForCopy(src: Notes, opts: { at: string; managerName: string | null }): Notes {
  const out: Notes = {}
  for (const [k, v] of Object.entries(src)) if (!COPY_DROP_KEYS.includes(k)) out[k] = v
  return {
    ...out,
    status: 'quote',
    quote_date: opts.at,
    ...(opts.managerName ? { manager_name: opts.managerName } : {}),
  }
}
