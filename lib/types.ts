export type Material = {
  id: number
  name: string
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
  unit: string
  cost_price: number
  sale_price: number | null
  active: boolean
  comment: string | null
}

export type HardwareItem = {
  id: number
  name: string
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
}

export type B2BService = {
  id: number
  name: string
  type: 'percent' | 'per_m2' | 'fixed'
  value: number
  description: string
  active: boolean
  sort_order: number
}

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
