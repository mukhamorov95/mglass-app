// Сопоставление позиций разных поставщиков по названию. Общий слой: им пользуются
// и поштучное сравнение в справочнике, и разбор «где мы переплачиваем», и закупка.
// Форматы прайсов у поставщиков разные, единого артикула нет — сравниваем по значимым
// словам названия.

export const isDefect = (name: string) => /дефект|-def\b|уценк|эконом/i.test(name || '')

// Значимые токены: слова от трёх букв и размеры вида «30х10», числа.
export function tokens(name: string, limit = 3): string[] {
  const norm = (name || '').toLowerCase().replace(/ё/g, 'е').replace(/[×хx]/g, 'х')
  const raw = norm.match(/[а-яa-z]{3,}|\d+(?:[.,]\d+)?(?:х\d+)*/gi) ?? []
  const stop = new Set(['для', 'под', 'все', 'шт', 'мм', 'см', 'фурнитура', 'нержавейка', 'алюминий'])
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of raw) {
    if (stop.has(t) || seen.has(t)) continue
    seen.add(t); out.push(t)
    if (out.length >= limit) break
  }
  return out
}

// Насколько строка похожа на образец: доля совпавших значимых слов. Нужна, чтобы
// «крепление трубы к стене» не считалось заменой «крепления трубы к стеклу».
export function similarity(a: string, b: string): number {
  const ta = tokens(a, 8), tb = new Set(tokens(b, 8))
  if (ta.length === 0) return 0
  return ta.filter(t => tb.has(t)).length / ta.length
}
