// Подпись расчёта в списках: русское имя типа + что именно посчитано.
// У быстрого расчёта (quick) и «Расчёта» (build) размеров на верхнем уровне
// input_data нет: там корзина изделий cart[{ title }], у build размеры лежат во
// вложенном dims. Списки подставляли width×height и показывали менеджеру
// «quick undefined×undefined мм».

const TYPE_LABELS: Record<string, string> = {
  mirror: 'Зеркало',
  loft: 'Лофт',
  shower: 'Душевая',
  shower_standard: 'Душевая',
  shower_budget: 'Душевая',
  railing: 'Ограждение',
  order: 'Заказ',
  quick: 'Быстрый расчёт',
  build: 'Расчёт',
}

type Input = Record<string, unknown> | null | undefined

export function calcTypeLabel(type: string | null | undefined): string {
  if (!type) return 'Расчёт'
  return TYPE_LABELS[type] ?? type
}

const mm = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function sizeText(width: unknown, height: unknown, width2?: unknown): string | null {
  const w = mm(width)
  const h = mm(height)
  if (!w || !h) return null
  const w2 = mm(width2)
  return w2 ? `${w}×${w2}×${h} мм` : `${w}×${h} мм`
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const isCartType = (type: string | null | undefined) => type === 'quick' || type === 'build'

function cart(input: Input): unknown[] {
  return Array.isArray(input?.cart) ? input.cart : []
}

// Название изделия без корзины: у quick — поле title формы, у build — модель и
// размеры (dims; в ранних снимках — на верхнем уровне и modelId вместо code).
function fallbackTitle(type: string, input: Input): string | null {
  const d = input ?? {}
  if (type === 'quick') return text(d.title) || null
  const dims = (d.dims && typeof d.dims === 'object' ? d.dims : d) as Record<string, unknown>
  const code = text(d.code) || text(d.modelId)
  const size = sizeText(dims.width, dims.height, dims.width2)
  return [code, size].filter(Boolean).join(' ') || null
}

// Что посчитано: размеры для зеркала/лофта/душевой, название изделия или число
// изделий для корзины. null — показать нечего (без «undefined»).
export function calcDetail(type: string | null | undefined, input: Input): string | null {
  if (!type) return null
  const d = input ?? {}
  if (type === 'mirror' || type === 'loft') return sizeText(d.width, d.height)
  if (type.startsWith('shower')) return text(d.dimStr) || sizeText(d.width, d.height)
  if (isCartType(type)) {
    const items = cart(d)
    if (items.length > 1) return `${items.length} изд.`
    const first = items[0] as Record<string, unknown> | undefined
    return text(first?.title) || fallbackTitle(type, d)
  }
  return null
}

// Одной строкой — для сообщений и логов. Корзина из нескольких изделий
// подписывается как в client_text расчёта: «Быстрый расчёт (3 изд.)».
export function calcCaption(type: string | null | undefined, input: Input): string {
  const label = calcTypeLabel(type)
  const items = isCartType(type) ? cart(input).length : 0
  if (items > 1) return `${label} (${items} изд.)`
  const detail = calcDetail(type, input)
  return detail ? `${label} ${detail}` : label
}
