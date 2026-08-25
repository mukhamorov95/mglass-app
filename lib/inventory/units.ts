import type { Unit, Kind, Contour, MoveReason } from './types'

export const UNITS: Unit[] = ['м2', 'шт', 'м.п.', 'кг', 'л', 'компл']

export const UNIT_LABELS: Record<Unit, string> = {
  'м2': 'м²', 'шт': 'шт', 'м.п.': 'м.п.', 'кг': 'кг', 'л': 'л', 'компл': 'компл.',
}

export const KIND_LABELS: Record<Kind, string> = {
  glass:      'Стекло',
  mirror:     'Зеркало',
  hardware:   'Фурнитура',
  profile:    'Профиль / штанга',
  seal:       'Уплотнители',
  led:        'Свет / электрика',
  consumable: 'Расходники',
  packaging:  'Упаковка',
  other:      'Прочее',
}

// Что по какому виду считают по умолчанию — подсказка формы, не жёсткое правило.
export const KIND_DEFAULT: Record<Kind, { unit: Unit; pack_label: string | null; contour: Contour }> = {
  glass:      { unit: 'м2',   pack_label: 'лист',     contour: 'b2b'  },
  mirror:     { unit: 'м2',   pack_label: 'лист',     contour: 'b2b'  },
  hardware:   { unit: 'шт',   pack_label: null,       contour: 'b2c'  },
  profile:    { unit: 'м.п.', pack_label: 'хлыст',    contour: 'b2c'  },
  seal:       { unit: 'м.п.', pack_label: 'хлыст',    contour: 'b2c'  },
  led:        { unit: 'м.п.', pack_label: 'бухта',    contour: 'b2c'  },
  consumable: { unit: 'шт',   pack_label: 'упаковка', contour: 'both' },
  packaging:  { unit: 'шт',   pack_label: 'упаковка', contour: 'both' },
  other:      { unit: 'шт',   pack_label: null,       contour: 'both' },
}

export const CONTOUR_LABELS: Record<Contour, string> = {
  b2b: 'B2B', b2c: 'B2C', both: 'Общее',
}

export const REASON_LABELS: Record<MoveReason, string> = {
  purchase:   'Приход от поставщика',
  return:     'Возврат на склад',
  order:      'Списание в заказ',
  production: 'Списание в производство',
  writeoff:   'Списание (прочее)',
  defect:     'Брак',
  count:      'Инвентаризация',
  init:       'Начальный остаток',
  manual:     'Ручная правка',
  transfer:   'Перемещение',
}

// Приход это или расход — определяет знак движения, а не отдельное поле.
export const INCOMING: MoveReason[] = ['purchase', 'return', 'init']

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d

// Площадь листа в м² по габаритам в мм: 3210×2250 → 7.2225
export function sheetArea(widthMm: number, heightMm: number): number {
  if (!widthMm || !heightMm) return 0
  return round(widthMm * heightMm / 1_000_000)
}

// Тара → базовая единица. 2 листа × 7.2225 = 14.445 м²
export function packToBase(packQty: number, packSize: number): number {
  if (!packSize || packSize <= 0) return round(packQty)
  return round(packQty * packSize)
}

// Базовая единица → тара. 18.1675 м² → 2.52 листа
export function baseToPack(qty: number, packSize: number): number {
  if (!packSize || packSize <= 0) return round(qty)
  return round(qty / packSize, 2)
}

export function formatQty(qty: number, unit: Unit): string {
  const decimals = unit === 'шт' || unit === 'компл' ? 0 : 2
  const n = Number(qty ?? 0)
  return `${n.toFixed(decimals).replace(/\.00$/, '')} ${UNIT_LABELS[unit] ?? unit}`
}

// «18.17 м² (2.52 листа)» — как человек это видит на полке.
export function describeQty(qty: number, unit: Unit, packLabel: string | null, packSize: number): string {
  const base = formatQty(qty, unit)
  if (!packLabel || !packSize || packSize <= 0) return base
  return `${base} (${baseToPack(qty, packSize)} ${packLabel})`
}

export type StockStatus = 'out' | 'low' | 'below_target' | 'ok'

export function stockStatus(item: { qty: number; min_qty: number; target_qty: number }): StockStatus {
  if (item.qty <= 0)                                      return 'out'
  if (item.min_qty > 0 && item.qty <= item.min_qty)       return 'low'
  if (item.target_qty > 0 && item.qty < item.target_qty)  return 'below_target'
  return 'ok'
}

export const STATUS_META: Record<StockStatus, { label: string; cls: string }> = {
  out:          { label: 'Нет',        cls: 'bg-red-50 text-red-700 border-red-200'          },
  low:          { label: 'Мало',       cls: 'bg-amber-50 text-amber-700 border-amber-200'    },
  below_target: { label: 'Ниже нормы', cls: 'bg-sky-50 text-sky-700 border-sky-200'          },
  ok:           { label: 'Норма',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

// Сколько дозакупить, чтобы вернуться к норме.
export function toOrderQty(item: { qty: number; min_qty: number; target_qty: number }): number {
  const target = item.target_qty > 0 ? item.target_qty : item.min_qty
  if (target <= 0) return 0
  return round(Math.max(0, target - item.qty))
}
