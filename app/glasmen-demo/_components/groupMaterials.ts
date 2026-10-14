import type { DemoMaterial } from './api'

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
