import { randomBytes } from 'crypto'

// А2/А5: публичная ссылка на КП. Токен живёт в notes.public_token — отдельной таблицы
// не заводим, ссылка это свойство просчёта. Наружу отдаём только то, что клиент и так
// видит в КП: себестоимость, маржа и внутренние поля вырезаются здесь, в одном месте.

export type PublicQuoteItem = {
  materialName?: string
  category?: string
  thickness?: number
  width?: number
  height?: number
  quantity?: number
  totalAreaNet?: number
  saleIncVat?: number
  manualTotal?: number | null
  hasTempering?: boolean
  hasFacet?: boolean
  facetTypeMm?: number | null
  shape?: string
  comment?: string
  services?: { id: number; name: string }[]
}

export type PublicQuote = {
  id: number
  number: string
  clientName: string
  createdAt: string
  quoteDate: string
  validUntil: string
  discountPercent: number
  totalBase: number
  totalFinal: number
  totalArea: number
  totalWeight: number
  productionDays: number
  paymentTerms: '50_50' | '100'
  managerName: string | null
  userNotes: string | null
  items: PublicQuoteItem[]
  status: 'quote' | 'agreed' | 'rejected' | 'launched'
  clientResponse: { action: 'approve' | 'question'; comment: string | null; at: string } | null
}

export function newPublicToken(): string {
  return randomBytes(16).toString('hex')
}

export function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (p && typeof p === 'object') return p as Record<string, unknown> } catch {}
  return {}
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

// Белый список полей позиции: всё, чего здесь нет, наружу не уходит.
function publicItem(raw: Record<string, unknown>): PublicQuoteItem {
  const num = (k: string) => {
    const v = Number(raw[k])
    return Number.isFinite(v) ? v : undefined
  }
  const services = Array.isArray(raw.services)
    ? (raw.services as Record<string, unknown>[]).map(s => ({ id: Number(s.id) || 0, name: String(s.name ?? '') }))
    : []
  return {
    materialName: raw.materialName ? String(raw.materialName) : undefined,
    category:     raw.category ? String(raw.category) : undefined,
    thickness:    num('thickness'),
    width:        num('width'),
    height:       num('height'),
    quantity:     num('quantity'),
    totalAreaNet: num('totalAreaNet'),
    saleIncVat:   num('saleIncVat'),
    manualTotal:  raw.manualTotal == null ? null : Number(raw.manualTotal),
    hasTempering: raw.hasTempering === true,
    hasFacet:     raw.hasFacet === true,
    facetTypeMm:  raw.facetTypeMm == null ? null : Number(raw.facetTypeMm),
    shape:        raw.shape ? String(raw.shape) : undefined,
    comment:      raw.comment ? String(raw.comment) : undefined,
    services,
  }
}

type OrderRow = {
  id: number
  client_name: string | null
  custom_number: string | null
  discount_percent: number | null
  items: unknown
  total_area: number | null
  total_weight: number | null
  total_sale_inc_vat: number | null
  total_after_discount: number | null
  notes: string | null
  created_at: string
}

export const PUBLIC_QUOTE_COLS =
  'id, client_name, custom_number, discount_percent, items, total_area, total_weight, total_sale_inc_vat, total_after_discount, notes, created_at'

export function toPublicQuote(order: OrderRow): PublicQuote {
  const notes = parseNotes(order.notes)
  const quoteDate = (notes.quote_date as string) || order.created_at
  const rawStatus = String(notes.status ?? 'quote')
  const status: PublicQuote['status'] =
    rawStatus === 'sent' || rawStatus === 'confirmed' ? 'launched'
    : rawStatus === 'agreed' ? 'agreed'
    : rawStatus === 'rejected' ? 'rejected'
    : 'quote'
  const resp = (notes.client_response && typeof notes.client_response === 'object')
    ? notes.client_response as PublicQuote['clientResponse']
    : null

  return {
    id:              order.id,
    number:          order.custom_number?.trim() || String(order.id).padStart(5, '0'),
    clientName:      order.client_name || 'Клиент',
    createdAt:       order.created_at,
    quoteDate,
    validUntil:      addDays(quoteDate, 14),
    discountPercent: Number(order.discount_percent) || 0,
    totalBase:       Number(order.total_sale_inc_vat) || 0,
    totalFinal:      Number(order.total_after_discount) || Number(order.total_sale_inc_vat) || 0,
    totalArea:       Number(order.total_area) || 0,
    totalWeight:     Number(order.total_weight) || 0,
    productionDays:  Number(notes.production_days) || 7,
    paymentTerms:    notes.kp_payment_terms === '100' ? '100' : '50_50',
    managerName:     (notes.manager_name as string | null) ?? null,
    userNotes:       (notes.user_notes as string | null) ?? null,
    items:           Array.isArray(order.items) ? (order.items as Record<string, unknown>[]).map(publicItem) : [],
    status,
    clientResponse:  resp,
  }
}

// Позиции для документа, который уходит наружу (счёт/УПД в кабинете партнёра,
// публичное КП). Тот же белый список, что в publicItem: себестоимость, маржа,
// расход материала и цены услуг остаются внутри компании.
export function documentSafeItems(items: unknown): PublicQuoteItem[] {
  if (!Array.isArray(items)) return []
  return (items as Record<string, unknown>[]).map(publicItem)
}

// Единственные поля notes, которые реально печатаются в документах наружу:
//   • quote_date, production_days — счёт (components/InvoiceDocument)
//   • shipped_date, launched_at   — дата УПД (components/UpdDocument)
// Всё остальное в notes — внутреннее (ai_review, status_history, status_comment,
// price_override, разбор AI, история цен…) и наружу идти не должно. Белый список
// здесь, в одной точке: любой вызыватель хелпера защищён по построению, а не по
// тому, вспомнил ли он затереть notes у себя.
const DOCUMENT_NOTE_FIELDS = ['quote_date', 'production_days', 'shipped_date', 'launched_at'] as const

export function documentSafeNotes(rawNotes: unknown): string | null {
  const parsed = parseNotes(typeof rawNotes === 'string' ? rawNotes : null)
  const out: Record<string, unknown> = {}
  for (const k of DOCUMENT_NOTE_FIELDS) {
    if (parsed[k] != null) out[k] = parsed[k]
  }
  return Object.keys(out).length ? JSON.stringify(out) : null
}

// Заказ для документа партнёра: ничего лишнего, кроме того, что печатается.
// items и notes очищены по построению — внутренние поля вырезаны здесь, а не у
// вызывателя. Реквизиты клиента вызыватель по-прежнему собирает белым списком сам.
export function documentSafeOrder(order: Record<string, unknown>) {
  return {
    id: Number(order.id),
    client_id: order.client_id == null ? null : Number(order.client_id),
    client_name: (order.client_name as string | null) ?? null,
    custom_number: (order.custom_number as string | null) ?? null,
    client_order_number: (order.client_order_number as string | null) ?? null,
    discount_percent: Number(order.discount_percent) || 0,
    items: documentSafeItems(order.items),
    total_sale_inc_vat: Number(order.total_sale_inc_vat) || 0,
    total_after_discount: Number(order.total_after_discount) || 0,
    notes: documentSafeNotes(order.notes),
    created_at: String(order.created_at ?? ''),
    launched_at: (order.launched_at as string | null) ?? null,
  }
}
