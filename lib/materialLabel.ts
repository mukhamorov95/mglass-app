// Единый ярлык материала для всех экранов и печатных форм.
//
// Зачем: в справочнике «Осветлённое» существует и как ЗЕРКАЛО (id 49/50), и как
// стекло («Осветлённое CrystalVision», «Flutelite-S (осветлённое)»). Экраны
// печатали только name + толщину — цех видел «Осветлённое 4 мм» и не мог понять,
// зеркало это или стекло. Категория в данных есть всегда, просто не выводилась.
//
// Правило: подписываем категорию, только если она не читается из самого названия
// — иначе получилось бы «Тонированное МОРУ БРОНЗА тонированное в массе».

export type MaterialLike = {
  materialName?: string | null
  category?: string | null
  thickness?: number | string | null
}

// Категории, которые обязаны быть видны на изделии: спутать их — брак и пересорт.
const PREFIX: Record<string, { label: string; hint: RegExp }> = {
  'зеркало':      { label: 'Зеркало',      hint: /зеркал/i },
  'рифленое':     { label: 'Рифлёное',     hint: /рифл|шиншилл|аквалайт|мору|moru|кафедрал/i },
  'сатин':        { label: 'Сатин',        hint: /сатин|matelux/i },
  'тонированное': { label: 'Тонированное', hint: /тонир|бронз|графит/i },
}

export function materialLabel(item: MaterialLike): string {
  const name = String(item.materialName ?? '').trim()
  if (!name) return String(item.category ?? '').trim()

  const cat = String(item.category ?? '').trim().toLowerCase()
  const rule = PREFIX[cat]
  const head = rule && !rule.hint.test(name) ? `${rule.label} ${name}` : name

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
