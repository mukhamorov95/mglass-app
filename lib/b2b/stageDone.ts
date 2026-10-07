// «Этап пройден» по b2b_orders.notes.stages — одно правило для всех читателей.
//
// Отметка лежит в трёх видах (замер прода 07.10):
//   • true — старые заказы без даты (≈3800 строк);
//   • 'YYYY-MM-DD' — экран заказов менеджера;
//   • ISO-время — отметка цеха.
// false / null / '' — этап не пройден. Сравнение `=== true` теряет все отметки с 25.08.
//
// Ключи тоже двух поколений: цех пишет edge_processed / packaged, старые заказы — edge / packed.

export type Stages = Record<string, unknown>

export const STAGE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  edge_processed: ['edge'],
  packaged: ['packed'],
}

export function markDone(v: unknown): boolean {
  if (v === true) return true
  if (typeof v !== 'string') return false
  const s = v.trim()
  return s !== '' && s !== 'false'
}

export function stagesOf(notes: Record<string, unknown> | null | undefined): Stages {
  const s = notes?.stages
  return s && typeof s === 'object' && !Array.isArray(s) ? s as Stages : {}
}

// Значение отметки с учётом старого имени ключа; undefined — этап не пройден.
export function stageMark(stages: Stages, key: string): unknown {
  for (const k of [key, ...(STAGE_ALIASES[key] ?? [])]) {
    if (markDone(stages[k])) return stages[k]
  }
  return undefined
}

export function isStageDone(stages: Stages, key: string): boolean {
  return stageMark(stages, key) !== undefined
}

// Дата отметки как записана ('YYYY-MM-DD' или ISO). У старого `true` даты нет — null.
export function stageDate(stages: Stages, key: string): string | null {
  const v = stageMark(stages, key)
  if (typeof v !== 'string') return null
  const s = v.trim()
  return Number.isNaN(Date.parse(s)) ? null : s
}
