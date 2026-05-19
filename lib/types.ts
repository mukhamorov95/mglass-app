export type Material = {
  id: number
  name: string
  short_name: string | null   // короткое название для показа в калькуляторе
  category: string
  unit: string
  cost_price: number
  sale_price: number | null  // расчётная цена для калькулятора (для зеркал — отличается от закупки)
  has_vat: boolean
  vat_rate: number
  active: boolean
  in_stock: boolean
  comment: string | null
  image_url: string | null
  created_at: string
  updated_at: string
}

export type Service = {
  id: number
  name: string
  short_name: string | null
  unit: string
  cost_price: number
  sale_price: number | null
  active: boolean
  comment: string | null
}

export type HardwareItem = {
  id: number
  name: string
  short_name: string | null
  system_type: 'sliding' | 'swing' | 'universal'
  unit: string
  cost_price: number | null
  active: boolean
  comment: string | null
}

export type FinancialSettings = {
  id: number
  tier: 'standard' | 'budget'
  product_type: string | null
  tax_percent: number
  manager_percent: number
  realization_percent: number
  marketing_percent: number
  transport_percent: number
  operation_percent: number
  default_margin: number
  min_margin: number
  green_threshold: number
  yellow_threshold: number
  red_threshold: number
  blocked_below: number
  max_discount_percent: number
  sla_days_approved:   number
  sla_days_in_work:    number
  updated_at: string
}

export function totalExpensesPercent(s: FinancialSettings): number {
  return s.tax_percent + s.manager_percent + s.realization_percent +
    s.marketing_percent + s.transport_percent + s.operation_percent
}

export type PartnerType = {
  id: number
  name: string
  percent: number
  active: boolean
}

export type Coefficient = {
  id: number
  name: string
  product_type: string | null
  condition_type: string | null
  condition_value: number | null
  effect_type: 'multiplier' | 'fixed_add'
  effect_value: number
  active: boolean
}

export type Calculation = {
  id: number
  created_at: string
  created_by: string | null
  product_type: string
  input_data: Record<string, unknown>
  cost_breakdown: Record<string, unknown>
  financial_breakdown: Record<string, unknown>
  base_price: number
  discount: number
  partner_percent: number
  final_price: number
  margin: number
  profit: number
  status: 'draft' | 'sent' | 'approved' | 'rejected'
  client_text: string | null
  notes: string | null
}

export type B2BClient = {
  id: number
  name: string
  contact: string | null
  phone: string | null
  discount_percent: number
  active: boolean
  notes: string | null
  created_at: string
  updated_at?: string   // present when selected — used for optimistic locking
  // Direct CRM columns — present only when explicitly selected in queries
  crm_segment?: string | null
  crm_status?: string | null
  crm_score?: string | null
  crm_city?: string | null
  crm_manager?: string | null
  crm_next_contact?: string | null  // DATE in DB, arrives as ISO string
  crm_notes?: string | null
}

// Interaction row from b2b_interactions table
export type B2BInteraction = {
  id: number
  client_id: number
  type: string
  note: string
  outcome: string | null
  next_action: string | null
  next_action_date: string | null
  created_by: string | null
  created_at: string
}

// Domain view of CRM fields — used in edit forms and display components
export type B2BCRM = {
  segment: string | null
  status: string | null
  score: string | null
  city: string | null
  manager_name: string | null
  next_contact_date: string | null
  crm_notes: string | null
}

const EMPTY_CRM: B2BCRM = {
  segment: null, status: null, score: null, city: null,
  manager_name: null, next_contact_date: null, crm_notes: null,
}

// Primary path: reads direct DB columns. Falls back to JSON parsing when the
// migration hasn't run yet (crm_status absent = column not selected or not applied).
export function clientToCRM(c: B2BClient): B2BCRM {
  if ('crm_status' in c) {
    return {
      segment:           c.crm_segment       ?? null,
      status:            c.crm_status        ?? null,
      score:             c.crm_score         ?? null,
      city:              c.crm_city          ?? null,
      manager_name:      c.crm_manager       ?? null,
      next_contact_date: c.crm_next_contact  ?? null,
      crm_notes:         c.crm_notes         ?? null,
    }
  }
  return parseCRM(c.notes)
}

// Legacy: parse CRM data from the notes JSON blob (pre-migration records)
export function parseCRM(notes: string | null): B2BCRM {
  if (!notes) return { ...EMPTY_CRM }
  try {
    const p = JSON.parse(notes)
    if (typeof p === 'object' && p !== null) {
      return {
        segment:           p.crm_segment      ?? null,
        status:            p.crm_status       ?? null,
        score:             p.crm_score        ?? null,
        city:              p.crm_city         ?? null,
        manager_name:      p.crm_manager      ?? null,
        next_contact_date: p.crm_next_contact ?? null,
        crm_notes:         p.crm_note         ?? null,
      }
    }
  } catch {}
  return { ...EMPTY_CRM }
}

// Legacy: merge CRM updates back into the notes JSON blob (pre-migration path).
// expectedUpdatedAt is unused here — optimistic locking is enforced at the DB level
// via .eq('updated_at', expectedUpdatedAt) on the Supabase update call.
export function mergeCRM(notes: string | null, crm: Partial<B2BCRM>, _expectedUpdatedAt?: string): string {
  let current: Record<string, unknown> = {}
  if (notes) { try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) current = p } catch {} }
  return JSON.stringify({
    ...current,
    ...(crm.segment !== undefined           ? { crm_segment:      crm.segment }           : {}),
    ...(crm.status !== undefined            ? { crm_status:       crm.status }            : {}),
    ...(crm.score !== undefined             ? { crm_score:        crm.score }             : {}),
    ...(crm.city !== undefined              ? { crm_city:         crm.city }              : {}),
    ...(crm.manager_name !== undefined      ? { crm_manager:      crm.manager_name }      : {}),
    ...(crm.next_contact_date !== undefined ? { crm_next_contact: crm.next_contact_date } : {}),
    ...(crm.crm_notes !== undefined         ? { crm_note:         crm.crm_notes }         : {}),
  })
}

export const B2B_SEGMENTS = [
  { value: 'designer',     label: 'Дизайнер' },
  { value: 'furniture',    label: 'Мебельщик' },
  { value: 'construction', label: 'Строитель' },
  { value: 'aluminum',     label: 'Алюминий/Перегородки' },
  { value: 'glass_company',label: 'Стекольная компания' },
  { value: 'office',       label: 'Офисы' },
  { value: 'other',        label: 'Другое' },
] as const

export const B2B_STATUSES = [
  { value: 'new',       label: 'Новый',     color: 'bg-blue-50 text-blue-700' },
  { value: 'contacted', label: 'Контакт',   color: 'bg-amber-50 text-amber-700' },
  { value: 'active',    label: 'Активный',  color: 'bg-emerald-50 text-emerald-700' },
  { value: 'sleeping',  label: 'Спящий',    color: 'bg-[#f0f0ec] text-[#6b6b66]' },
  { value: 'lost',      label: 'Потерян',   color: 'bg-red-50 text-red-600' },
] as const

export const B2B_SCORES = [
  { value: 'A', label: 'A', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'B', label: 'B', color: 'bg-amber-100 text-amber-800' },
  { value: 'C', label: 'C', color: 'bg-[#f0f0ec] text-[#6b6b66]' },
] as const

export const B2B_INTERACTION_TYPES = [
  { value: 'call',       label: 'Звонок',        icon: '📞' },
  { value: 'message',    label: 'Сообщение',     icon: '💬' },
  { value: 'meeting',    label: 'Встреча',       icon: '🤝' },
  { value: 'quote_sent', label: 'КП отправлено', icon: '📄' },
  { value: 'order',      label: 'Заказ',         icon: '📦' },
  { value: 'note',       label: 'Заметка',       icon: '📝' },
] as const

export const FRAME_TYPES = [
  { value: 'slim',      label: 'Slim' },
  { value: 'classic',   label: 'Classic' },
  { value: 'shadow',    label: 'Shadow' },
  { value: 'loft',      label: 'Loft' },
  { value: 'minimal',   label: 'Minimal' },
  { value: 'aluminium', label: 'Aluminium' },
  { value: 'steel',     label: 'Steel' },
] as const

export const FRAME_COLORS = [
  { value: 'black',    label: 'Чёрный'        },
  { value: 'white',    label: 'Белый'          },
  { value: 'graphite', label: 'Графит'         },
  { value: 'gold',     label: 'Золото'         },
  { value: 'brush',    label: 'Браш'           },
  { value: 'chrome',   label: 'Хром'           },
  { value: 'custom',   label: 'Индивидуальный' },
] as const

export type MirrorFrame = {
  id: number
  article: string | null
  name: string
  supplier: string | null
  supplier_url: string | null
  frame_type: string
  color: string
  profile_size: string | null
  whip_length_m: number
  cost_per_m: number
  sale_per_m: number
  waste_factor: number
  cut_minutes: number
  assemble_minutes: number
  pack_minutes: number
  assemble_cost_rub: number | null
  assemble_sale_rub: number | null
  image_url: string | null
  active: boolean
  sort_order: number
  notes: string | null
  created_at: string
}

// Frame cost calculation result (embedded in mirror calc)
export type FrameCalcResult = {
  perimeterM: number
  profileNeededM: number
  whipsNeeded: number
  whipLengthM: number
  profileCost: number
  assemblyCost: number
  totalCost: number
  assemblySale: number
  totalSale: number   // for display reference
  leftoverM: number
  totalMinutes: number
}

export const FRAME_ASSEMBLY_COST_RATE  = 3.5   // fallback ₽/мин (используется если нет production_settings)
export const FRAME_ASSEMBLY_SALE_RATE  = 7.0   // fallback ₽/мин

export function calcFrameCost(
  frame: MirrorFrame,
  width: number,
  height: number,
  costMinuteRate?: number,
  saleMinuteRate?: number,
): FrameCalcResult {
  const effectiveCostRate = costMinuteRate ?? FRAME_ASSEMBLY_COST_RATE
  const effectiveSaleRate = saleMinuteRate ?? FRAME_ASSEMBLY_SALE_RATE
  const perimeterM      = (width + height) * 2 / 1000
  const profileNeededM  = perimeterM * frame.waste_factor
  const whipsNeeded     = Math.ceil(profileNeededM / frame.whip_length_m)
  const whipLengthM     = frame.whip_length_m
  const leftoverM       = whipsNeeded * whipLengthM - profileNeededM
  const profileCost     = Math.round(whipsNeeded * whipLengthM * frame.cost_per_m)
  const totalMinutes    = frame.cut_minutes + frame.assemble_minutes + frame.pack_minutes
  const assemblyCost    = frame.assemble_cost_rub != null
    ? frame.assemble_cost_rub
    : Math.round(totalMinutes * effectiveCostRate)
  const assemblySale    = frame.assemble_sale_rub != null
    ? frame.assemble_sale_rub
    : Math.round(totalMinutes * effectiveSaleRate)
  const totalCost       = profileCost + assemblyCost
  const totalSale       = Math.round(profileNeededM * frame.sale_per_m) + assemblySale
  return { perimeterM, profileNeededM, whipsNeeded, whipLengthM, profileCost, assemblyCost, totalCost, assemblySale, totalSale, leftoverM, totalMinutes }
}

export type B2BFilm = {
  id: number
  name: string
  cost_price_per_m2: number
  sale_price_per_m2: number
  work_cost_per_m2: number
  work_sale_per_m2: number
  description?: string | null
  active: boolean
  sort_order: number
}

export type B2BService = {
  id: number
  name: string
  type: 'percent' | 'per_m2' | 'fixed' | 'calculated' | 'film'
  value: number
  cost_price: number
  description: string
  active: boolean
  sort_order: number
  // Поля для автоматического расчёта себестоимости (time_minutes > 0 = рассчитываемая услуга)
  time_minutes?: number
  equipment_depr_rub?: number
  consumables_cost_rub?: number
  overhead_override_pct?: number | null
  margin_override_pct?: number | null
  sale_price_override?: number | null
  size_tiers?: import('./calcServiceCost').SizeTier[]
  unit_label?: string
}

export type PatternDirection = 'none' | 'along_length' | 'along_width'

export type B2BMaterial = {
  id: number
  name: string
  category: string
  thickness: number
  cost_price: number
  sale_price: number
  vat_rate: number
  waste_percent: number
  active: boolean
  passthrough: boolean  // проходной материал — отход всегда 10%
  notes: string | null
  created_at: string
  // Раскрой
  sheet_width: number            // мм, default 3210
  sheet_height: number           // мм, default 2250
  pattern_direction: PatternDirection  // направление рисунка для рифлёного стекла
}

export const B2B_CATEGORIES = [
  { value: 'стекло',       label: 'Стекло прозрачное',  wasteDefault: 15 },
  { value: 'зеркало',      label: 'Зеркало',             wasteDefault: 18 },
  { value: 'тонированное', label: 'Тонированное',        wasteDefault: 20 },
  { value: 'сатин',        label: 'Сатинированное',      wasteDefault: 22 },
  { value: 'рифленое',     label: 'Рифлёное',            wasteDefault: 30 },
  { value: 'декоративное', label: 'Декоративное',        wasteDefault: 25 },
] as const

export const MATERIAL_CATEGORIES = [
  'зеркало',
  'стекло',
  'подсветка',
  'профиль',
  'электрика',
  'расходники',
  'работа',
  'услуга',
  'фурнитура',
] as const

export type MaterialCategory = typeof MATERIAL_CATEGORIES[number]

// ─── Orders ───────────────────────────────────────────────────────────────────

export type MarginStatus = 'green' | 'yellow' | 'red' | 'blocked'

export type OrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'in_work'
  | 'completed'
  | 'cancelled'

export function computeMarginStatus(
  margin: number,
  settings: {
    default_margin?: number; min_margin?: number;
    green_threshold?: number; yellow_threshold?: number;
    blocked_below?: number
  },
): MarginStatus {
  const greenT   = settings.green_threshold  ?? settings.default_margin ?? 35
  const yellowT  = settings.yellow_threshold ?? settings.min_margin     ?? 25
  const blockedT = settings.blocked_below    ?? 0
  if (margin < blockedT)  return 'blocked'
  if (margin < yellowT)   return 'red'
  if (margin < greenT)    return 'yellow'
  return 'green'
}

export const MARGIN_STATUS_LABELS: Record<MarginStatus, string> = {
  green:   'Рекомендовано',
  yellow:  'Допустимо',
  red:     'Ниже минимума',
  blocked: 'Запрещено',
}

export const MARGIN_STATUS_COLORS: Record<MarginStatus, { bg: string; text: string; border: string }> = {
  green:   { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  yellow:  { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200'   },
  red:     { bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200'     },
  blocked: { bg: 'bg-neutral-900 bg-opacity-90', text: 'text-white', border: 'border-neutral-800' },
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft:            'Черновик',
  pending_approval: 'Ждёт одобрения',
  approved:         'Одобрен',
  in_work:          'В работе',
  completed:        'Завершён',
  cancelled:        'Отменён',
}

export type BOMLine = {
  name:      string
  qty:       number
  unit:      string
  unit_cost: number
  total:     number
}

export type PaymentStatus = 'unpaid' | 'partial' | 'paid'

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid:  'Не оплачен',
  partial: 'Предоплата',
  paid:    'Оплачен',
}

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  unpaid:  'bg-red-50 text-red-700 border-red-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  paid:    'bg-emerald-50 text-emerald-700 border-emerald-200',
}

export type Order = {
  id:                      string
  number:                  string
  custom_number:           string | null
  amo_deal_id:             string | null
  amo_deal_url:            string | null
  client_name:             string
  client_phone:            string | null
  object_address:          string | null
  manager_id:              string | null
  order_type:              string
  notes:                   string | null
  total_sale_price:        number
  total_cost_price:        number
  gross_profit:            number
  margin_percent:          number
  margin_status:           MarginStatus
  status:                  OrderStatus
  approved_by:             string | null
  approved_at:             string | null
  approval_notes:          string | null
  created_at:              string
  launched_at:             string | null
  planned_completion_date: string | null
  deadline:                string | null
  actual_completion_date:  string | null
  // Payment tracking
  payment_status:          PaymentStatus | null
  prepayment_amount:       number | null
  prepayment_date:         string | null
  payment_notes:           string | null
  // Phase 2
  delivery_address:        string | null
  completion_photos:       string[]
  // Integrations
  delivery_zone_id:        string | null
  delivery_cost:           number
  brigade_id:              string | null
}

export type OrderLine = {
  id:              string
  order_id:        string
  position_num:    number
  product_type:    string
  product_name:    string
  description:     string | null
  dimensions_text: string | null
  quantity:        number
  unit:            string
  unit_cost_price: number
  unit_sale_price: number
  discount_percent: number
  line_cost_price: number
  line_sale_price: number
  margin_percent:  number
  margin_status:   MarginStatus
  input_snapshot:  Record<string, unknown> | null
  cost_snapshot:   Record<string, unknown> | null
  materials_bom:   BOMLine[] | null
  hardware_bom:    BOMLine[] | null
  services_bom:    BOMLine[] | null
  status:          string
  calculation_id:  number | null
  notes:           string | null
}
