import type { Unit } from './types'

// Названия в BOM заказов пишут люди и калькуляторы — сопоставляем нормализованно.
export function normalizeName(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    // «8мм» и «8 мм» — одна и та же позиция, поставщики пишут и так, и так
    .replace(/(\d)([a-zа-я])/gi, '$1 $2')
    .replace(/([a-zа-я])(\d)/gi, '$1 $2')
    .trim()
    .replace(/\s+/g, ' ')
}

const UNIT_MAP: Record<string, Unit> = {
  'м2': 'м2', 'м²': 'м2', 'кв.м': 'м2', 'кв м': 'м2', 'm2': 'м2',
  'шт': 'шт', 'шт.': 'шт', 'штук': 'шт',
  'м.п.': 'м.п.', 'мп': 'м.п.', 'м/п': 'м.п.', 'пог.м': 'м.п.', 'п.м': 'м.п.', 'м': 'м.п.',
  'кг': 'кг', 'л': 'л',
  'компл': 'компл', 'компл.': 'компл', 'комплект': 'компл', 'к-т': 'компл',
}

export function normalizeUnit(s: string | null | undefined): Unit | null {
  if (!s) return null
  return UNIT_MAP[s.trim().toLowerCase()] ?? null
}

// Строки BOM, которые складом не являются: работа, логистика, налоги.
const SERVICE_HINTS = [
  'монтаж', 'доставка', 'подъем', 'подъём', 'замер', 'работа', 'услуг',
  'налог', 'наценк', 'маржа', 'транспорт', 'выезд', 'демонтаж', 'сборка',
]

export function isServiceLine(name: string): boolean {
  const n = normalizeName(name)
  return SERVICE_HINTS.some(h => n.includes(h))
}

// Похожие позиции — подсказка «это не то же самое?» для непривязанных строк BOM.
export function suggestMatches<T extends { id: number; name: string }>(
  name: string, stock: T[], limit = 3,
): T[] {
  const tokens = normalizeName(name).split(' ').filter(t => t.length > 2)
  if (!tokens.length) return []
  return stock
    .map(s => {
      const sn = normalizeName(s.name)
      return { s, score: tokens.filter(t => sn.includes(t)).length }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.s)
}
