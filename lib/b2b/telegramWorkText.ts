// Текст заказа для Telegram (У5). Жил внутри экрана просчётов — теперь нужен и в
// карточке заказа, где менеджер делает с заказом всё. Логика не менялась: группировка
// позиций, названия стекла и зеркала, сумма с точками вместо пробелов.

import { finalTotalOf } from './priceOverride'

// Берём только те поля, которые нужны тексту: экран просчётов и карточка заказа
// держат позицию в разных типах, а общего у них ровно это.
export type TelegramItem = {
  materialName?: string
  category?: string
  thickness?: number
  width?: number
  height?: number
  quantity?: number
  hasTempering?: boolean
}

export type TelegramQuote = {
  id: number
  custom_number: string | null
  client_name: string
  items: TelegramItem[]
  total_after_discount?: number
  total_sale_inc_vat?: number
}

function formatTelegramRub(value: number): string {
  // Dot as thousands separator, no ₽ symbol — matches Telegram work text convention.
  return Math.round(value).toLocaleString('ru-RU').replace(/\s/g, '.') + ' руб'
}

function formatTelegramClientName(name: string): string {
  if (!name?.trim()) return 'Без клиента'
  const n = name.trim()
  if (/^m[\s-]?glass$/i.test(n) || /^мгласс$/i.test(n)) return 'МГЛАСС'
  return n
}

function normalizeGlassGrade(materialName: string): string {
  if (/м1|m1/i.test(materialName)) return 'м1'
  if (/прозрачн/i.test(materialName)) return 'м1'
  return materialName.trim().toLowerCase()
}

function normalizeMirrorType(materialName: string): string {
  const n = materialName.trim().toLowerCase()
  if (/серебр|silver|сильвер/.test(n)) return 'сильвер'
  if (/осветл/.test(n)) return 'осветленное'
  if (/crystal|кристал|vision|вижн/.test(n)) return 'кристал вижн'
  // Strip leading "зеркало " prefix — we already add "Зеркало" in the label
  return n.replace(/^зеркало\s+/i, '').trim() || n
}

type TgGroup = { label: string; qty: number }

function buildTelegramPositionLines(quote: TelegramQuote): string[] {
  if (quote.items.length === 0) return ['Расчёт B2B - см. PDF']

  const groups = new Map<string, TgGroup>()

  for (const item of quote.items) {
    const qty       = item.quantity ?? 1
    const matName   = (item.materialName || '').trim()
    const isGlass   = item.category !== 'зеркало'
    const thickness = item.thickness ?? 0
    const thStr     = thickness > 0 ? `${thickness}мм` : ''

    let key: string
    let label: string

    if (isGlass) {
      const grade      = normalizeGlassGrade(matName)
      const tempSuffix = (item.hasTempering ?? false) ? ' закаленное' : ''
      key   = `glass|${matName}|${thickness}|${item.hasTempering ?? false}`
      label = `Стекло ${thStr} ${grade}${tempSuffix}`.replace(/\s{2,}/g, ' ').trim()
    } else {
      // Mirror: derive shape from dimensions — equal width/height → round, otherwise rectangular
      const mirrorType = normalizeMirrorType(matName)
      const w     = item.width  ?? 0
      const h     = item.height ?? 0
      const shape = w > 0 && h > 0 && w === h ? 'круглое' : 'прямоугольное'
      key   = `mirror|${matName}|${thickness}|${shape}`
      label = `Зеркало ${thStr} ${mirrorType} ${shape}`.replace(/\s{2,}/g, ' ').trim()
    }

    const g = groups.get(key)
    if (g) { g.qty += qty } else { groups.set(key, { label, qty }) }
  }

  return Array.from(groups.values()).map(g => `${g.label} - ${g.qty} шт`)
}

export function buildTelegramWorkText(quote: TelegramQuote): string {
  const quoteNumber = quote.custom_number?.trim() || `00${quote.id}`
  const clientName  = formatTelegramClientName(quote.client_name ?? '')
  const finalPrice  = finalTotalOf(quote)
  const lines       = [quoteNumber, clientName, ...buildTelegramPositionLines(quote)]
  lines.push('', `🥝${formatTelegramRub(finalPrice)}`)
  return lines.join('\n')
}

