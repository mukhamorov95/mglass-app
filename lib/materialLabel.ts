// Единый ярлык материала для всех экранов и печатных форм.
//
// Зачем: «Тонированное (бронза/графит)» и «Осветлённое» есть в справочнике и как зеркало,
// и как стекло, а экраны печатали только название. В каждом документе должно быть прямо
// написано, стекло это или зеркало (владелец 03.11.2026). Решает категория, а не название.
// Только для показа: сохранённый materialName не меняем, по нему сопоставляются позиции.

export type MaterialLike = {
  materialName?: string | null
  category?: string | null
  thickness?: number | string | null
}

export type MaterialKind = 'Стекло' | 'Зеркало'

const GLASS_CATEGORIES = new Set(['стекло', 'тонированное', 'сатин', 'рифленое', 'рифлёное'])

export function materialKind(item: Pick<MaterialLike, 'materialName' | 'category'>): MaterialKind | null {
  const name = String(item.materialName ?? '').trim()
  const cat = String(item.category ?? '').trim().toLowerCase()
  if (cat === 'зеркало') return 'Зеркало'
  if (GLASS_CATEGORIES.has(cat)) return 'Стекло'
  if (cat || !name) return null   // «изделие»: готовый товар, название говорит само за себя
  return /зеркал|mirror/i.test(name) ? 'Зеркало' : 'Стекло'
}

// Спутать эти виды стекла — брак и пересорт: подписываем, если вид не читается из названия.
const GLASS_TYPE: Record<string, { label: string; hint: RegExp }> = {
  'рифленое':     { label: 'рифлёное',     hint: /рифл|шиншилл|аквалайт|мору|moru|кафедрал|kathedral/i },
  'рифлёное':     { label: 'рифлёное',     hint: /рифл|шиншилл|аквалайт|мору|moru|кафедрал|kathedral/i },
  'сатин':        { label: 'сатин',        hint: /сатин|matelux/i },
  'тонированное': { label: 'тонированное', hint: /тонир|бронз|графит/i },
}

// «Тонированное (бронза/графит)» → «Стекло тонированное (бронза/графит)». Собственные имена
// пишем как есть: «Зеркало Серебро», «Стекло Lumilac». Нет названия — хотя бы вид.
export function materialWithKind(item: Pick<MaterialLike, 'materialName' | 'category'>, fallback = ''): string {
  const name = String(item.materialName ?? '').trim()
  const kind = materialKind(item)
  if (!name) return kind ?? fallback
  if (!kind) return name
  const type = GLASS_TYPE[String(item.category ?? '').trim().toLowerCase()]
  const typed = type && !type.hint.test(name) ? `${type.label} ${name}` : name
  if ((kind === 'Зеркало' ? /зеркал/i : /стекл/i).test(typed)) return typed
  return `${kind} ${typed.replace(/^([А-ЯЁ])([а-яё]*ое)(?=[\s(,]|$)/, (_, first: string, rest: string) => first.toLowerCase() + rest)}`
}

export const SERVICE_LINE_RE = /монтаж|демонтаж|доставк|подъ[её]м|замер|выезд/i

// Договор и розничное КП пишутся свободным текстом, категории там нет: подставить слово
// нельзя, можно только показать менеджеру строку, где его нет.
export function specLacksKind(line: { name?: string | null; desc?: string | null }): boolean {
  const text = `${line.name ?? ''} ${line.desc ?? ''}`.trim()
  return !!text && !SERVICE_LINE_RE.test(line.name ?? '') && !/стекл|зеркал/i.test(text)
}

export function materialLabel(item: MaterialLike): string {
  const name = String(item.materialName ?? '').trim()
  if (!name) return String(item.category ?? '').trim()

  const head = materialWithKind(item)

// Толщина уже в названии (изделия производства: «… Осветлённое 4 мм») —
  // второй раз не дописываем.
  if (/\d+\s*мм\s*$/i.test(name)) return head
  const t = Number(item.thickness)
  return t > 0 ? `${head} ${t} мм` : head
}

// Компактный вариант для узких карточек цеха: «Зеркало Осветлённое 4мм»
export function materialLabelShort(item: MaterialLike): string {
  return materialLabel(item).replace(/(\d+)\s+мм$/, '$1мм')
}
