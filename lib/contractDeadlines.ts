// Сроки договора по типу изделия. Менеджер выбирает тип → срок в п.4.1 подставляется сам.
// Зеркало/Душевая/Лофт: 15 раб.дн. изготовление + 5 монтаж. Сварное: 25 + 5.
// Если в договоре есть сварное изделие — берётся больший срок (25+5).

export type ProductKind = 'mirror' | 'shower' | 'loft' | 'welded'

export const PRODUCT_DEADLINES: Record<ProductKind, { label: string; make: number; install: number }> = {
  mirror: { label: 'Зеркало',          make: 15, install: 5 },
  shower: { label: 'Душевая',          make: 15, install: 5 },
  loft:   { label: 'Лофт-перегородка', make: 15, install: 5 },
  welded: { label: 'Сварное изделие',  make: 25, install: 5 },
}

export type Deadline = { make: number; install: number; total: number }

// Срок по выбранному типу. hasWelded=true форсирует сварной пресет (микс в спецификации).
export function deadlineFor(kind: ProductKind, hasWelded = false): Deadline {
  const k = hasWelded ? 'welded' : kind
  const d = PRODUCT_DEADLINES[k]
  return { make: d.make, install: d.install, total: d.make + d.install }
}

// Число прописью (для «Пятнадцать (15)» в тексте договора).
const WORDS: Record<number, string> = {
  5: 'Пять', 15: 'Пятнадцать', 20: 'Двадцать', 25: 'Двадцать пять', 30: 'Тридцать',
}
export const daysInWords = (n: number) => WORDS[n] ?? String(n)
