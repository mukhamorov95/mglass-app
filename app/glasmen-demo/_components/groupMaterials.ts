import type { DemoMaterial } from './api'
import { isMirror } from './api'

export type MaterialFamily = { key: string; category: string; name: string; items: DemoMaterial[] }
export type MaterialCategory = { category: string; families: MaterialFamily[] }

// Категория → материал (имя) → толщины по возрастанию. Порядок категорий и имён — как пришли.
export function groupMaterials(list: DemoMaterial[]): MaterialCategory[] {
  const cats = new Map<string, Map<string, DemoMaterial[]>>()
  for (const m of list) {
    const cat = m.category || 'Без категории'
    if (!cats.has(cat)) cats.set(cat, new Map())
    const fam = cats.get(cat)!
    if (!fam.has(m.name)) fam.set(m.name, [])
    fam.get(m.name)!.push(m)
  }
  return [...cats.entries()].map(([category, fams]) => ({
    category,
    families: [...fams.entries()].map(([name, items]) => ({
      key: `${category}::${name}`,
      category,
      name,
      items: [...items].sort((a, b) => a.thickness - b.thickness),
    })),
  }))
}

export const categoryTitle = (c: string) => (c ? c.charAt(0).toUpperCase() + c.slice(1) : c)

// Шаги расчёта: стекло или зеркало → толщина → материал этой толщины.
export type Kind = 'glass' | 'mirror'
export const KIND_TITLE: Record<Kind, string> = { glass: 'Стекло', mirror: 'Зеркало' }
export const kindOf = (m: DemoMaterial): Kind => (isMirror(m) ? 'mirror' : 'glass')

export function thicknessesFor(list: DemoMaterial[], kind: Kind): { t: number; from: number; count: number }[] {
  const by = new Map<number, DemoMaterial[]>()
  for (const m of list) if (kindOf(m) === kind) by.set(m.thickness, [...(by.get(m.thickness) ?? []), m])
  return [...by.entries()].sort((a, b) => a[0] - b[0])
    .map(([t, ms]) => ({ t, from: Math.min(...ms.map(m => m.pricePerM2)), count: ms.length }))
}

// Материалы вида и толщины по категориям; внутри категории — от дешёвого к дорогому.
export function materialsFor(list: DemoMaterial[], kind: Kind, t: number | null): { category: string; items: DemoMaterial[] }[] {
  const ms = list.filter(m => kindOf(m) === kind && m.thickness === t)
  const cats = [...new Set(ms.map(m => m.category || 'Без категории'))]
  // Группа с самым дешёвым материалом — первой: базовое стекло выше рифлёного и сатина.
  return cats.map(category => ({
    category,
    items: ms.filter(m => (m.category || 'Без категории') === category).sort((a, b) => a.pricePerM2 - b.pricePerM2 || a.name.localeCompare(b.name, 'ru')),
  })).sort((a, b) => a.items[0].pricePerM2 - b.items[0].pricePerM2)
}

// Толщина по умолчанию: прежняя, если есть у вида; иначе ходовая (стекло 8, зеркало 4); иначе ближайшая к прежней.
const COMMON_T: Record<Kind, number> = { glass: 8, mirror: 4 }
export function pickThickness(list: DemoMaterial[], kind: Kind, prev: number | null): number | null {
  const ts = thicknessesFor(list, kind).map(x => x.t)
  if (!ts.length) return null
  if (prev !== null && ts.includes(prev)) return prev
  if (ts.includes(COMMON_T[kind])) return COMMON_T[kind]
  const ref = prev ?? COMMON_T[kind]
  return ts.reduce((best, t) => (Math.abs(t - ref) < Math.abs(best - ref) ? t : best), ts[0])
}

// Материал по умолчанию: тот же по имени, иначе базовый (прозрачное / серебро), иначе самый дешёвый.
const BASE: Record<Kind, RegExp> = { glass: /прозрачн/i, mirror: /серебр/i }
export function pickMaterial(list: DemoMaterial[], kind: Kind, t: number | null, prevName: string | null): DemoMaterial | null {
  const ms = materialsFor(list, kind, t).flatMap(c => c.items)
  if (!ms.length) return null
  return ms.find(m => m.name === prevName)
    ?? [...ms].sort((a, b) => a.pricePerM2 - b.pricePerM2).find(m => BASE[kind].test(m.name))
    ?? [...ms].sort((a, b) => a.pricePerM2 - b.pricePerM2)[0]
}
