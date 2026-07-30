// Авто-надбавки за габариты/сложность изделия (справочник b2b_surcharge_rules).
//
// Надбавка применяется как обычная процентная услуга: превращаем правило в
// синтетическую услугу type='percent' и отдаём её в calcItem вместе с реальными
// услугами. Дальше вся существующая механика (цена в saleIncVat, строка в КП,
// чип в калькуляторе, сохранение в items JSON) работает без изменений.
//
// Ось габарита:
//   length / shape → длинная сторона детали  = max(width, height)
//   width          → короткая сторона детали = min(width, height)
// shape-правила применяются только к криволинейным (shape='curved').

export type SurchargeAxis = 'length' | 'width' | 'shape'

export type SurchargeRule = {
  id: number
  axis: SurchargeAxis
  min_mm: number            // включительно
  max_mm: number | null     // исключительно; null = ∞
  surcharge_percent: number
  label: string
  shape_filter: 'curved' | null
  active?: boolean
  sort_order?: number
}

export type SurchargeDims = {
  width: number
  height: number
  shape?: 'rect' | 'curved'
}

// Форма каталожной услуги b2b_services, которую ждёт calcItem (type='percent').
// Содержит все обязательные поля B2BService, поэтому массив таких объектов
// присваивается B2BService[] без каста. Доп-поля (ruleId/percent) — для UI.
export type SurchargeService = {
  id: number
  name: string
  type: 'percent'
  value: number
  cost_price: number
  description: string
  active: boolean
  sort_order: number
  ruleId: number
  percent: number
}

// Синтетические id надбавок — глубоко отрицательные, чтобы никогда не пересечься
// с реальными id услуг/плёнок (они положительные).
const SURCHARGE_ID_BASE = -1_000_000

export function surchargeSyntheticId(ruleId: number): number {
  return SURCHARGE_ID_BASE - ruleId
}

export function isSurchargeServiceId(id: number): boolean {
  return id <= SURCHARGE_ID_BASE
}

// Правила, применимые к позиции по её габаритам и форме. Диапазоны внутри одной
// оси не пересекаются, поэтому попадёт максимум одно правило на ось.
export function applicableSurcharges(dims: SurchargeDims, rules: SurchargeRule[]): SurchargeRule[] {
  const w = Number(dims.width) || 0
  const h = Number(dims.height) || 0
  if (w <= 0 || h <= 0) return []
  const long = Math.max(w, h)
  const short = Math.min(w, h)
  const curved = dims.shape === 'curved'

  return rules
    .filter(r => r.active !== false)
    .filter(r => {
      if (r.shape_filter === 'curved' && !curved) return false
      const val = r.axis === 'width' ? short : long
      const min = Number(r.min_mm) || 0
      const max = r.max_mm == null ? Infinity : Number(r.max_mm)
      return val >= min && val < max
    })
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

// Правило → синтетическая услуга-надбавка для calcItem.
export function ruleToSurchargeService(rule: SurchargeRule): SurchargeService {
  const percent = Number(rule.surcharge_percent) || 0
  return {
    id: surchargeSyntheticId(rule.id),
    name: `${rule.label} (+${percent}%)`,
    type: 'percent',
    value: percent,
    cost_price: 0,
    description: '',
    active: true,
    sort_order: 0,
    ruleId: rule.id,
    percent,
  }
}

// Применимые надбавки за вычетом снятых вручную → массив услуг для calcItem.
export function surchargeServicesFor(
  dims: SurchargeDims,
  rules: SurchargeRule[],
  dismissed: Set<number> = new Set(),
): SurchargeService[] {
  return applicableSurcharges(dims, rules)
    .filter(r => !dismissed.has(r.id))
    .map(ruleToSurchargeService)
}
