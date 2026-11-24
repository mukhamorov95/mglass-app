// Материал по умолчанию и материалы, которые клиент сам не считает.
// Решение владельца 24.11.2026: в любой толщине по умолчанию стоит «Прозрачное М1»
// (неосветлённое), у зеркала — «Серебро»; и у менеджера, и в кабинете партнёра.
// Рифлёное стекло (кафедрал, эстриадо, мору, флютлайт, иероглифы) из кабинета убрано:
// его раскрой и цену считает менеджер, пока не отлажено, чтобы клиент считал верно.

type Mat = { name: string; category: string; thickness: number }
export type MaterialKind = 'стекло' | 'зеркало'

const DEFAULT_NAME: Record<MaterialKind, RegExp> = {
  стекло: /^прозрачное\s*м1$/i,
  зеркало: /^(зеркало\s+)?серебро$/i,
}

const PATTERNED_NAME = /estriado|эстриад|kathedral|кафедрал|flutelite|флютлайт|иероглиф|moru|мору|рифл/i

export function isPatterned(m: Pick<Mat, 'name' | 'category'>): boolean {
  return m.category === 'рифленое' || PATTERNED_NAME.test(m.name)
}

// Клиент (кабинет партнёра, прилавок) видит и считает только эти материалы.
export function isClientCalculable(m: Pick<Mat, 'name' | 'category'>): boolean {
  return !isPatterned(m)
}

// Материал по умолчанию в выбранной толщине: М1 / Серебро, иначе первый по порядку списка.
export function defaultAt<T extends Mat>(mats: T[], kind: MaterialKind, thickness: number | null): T | null {
  const at = mats.filter(m => m.thickness === thickness)
  return at.find(m => DEFAULT_NAME[kind].test(m.name.trim())) ?? at[0] ?? null
}

// Толщина и материал при открытии формы: желаемая толщина, если там есть М1/Серебро,
// иначе первая толщина, где они есть, иначе первая вообще.
export function defaultPick<T extends Mat>(mats: T[], kind: MaterialKind, wantThickness: number): T | null {
  const ths = [...new Set(mats.map(m => m.thickness))].sort((a, b) => a - b)
  const hasDefault = (t: number) => mats.some(m => m.thickness === t && DEFAULT_NAME[kind].test(m.name.trim()))
  const t = hasDefault(wantThickness) ? wantThickness : (ths.find(hasDefault) ?? (ths.includes(wantThickness) ? wantThickness : ths[0]))
  return t == null ? null : defaultAt(mats, kind, t)
}
