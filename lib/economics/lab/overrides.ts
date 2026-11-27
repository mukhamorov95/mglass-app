import { referenceErrors, type Reference } from '../engine/reference'
import type { LabOverride } from './project'

// Правка норматива внутри одного проекта. Глобальный справочник не меняется: получается
// производная версия с тем же номером и другим отпечатком, и этот отпечаток попадает в
// сохранённый вариант — по нему видно, что расчёт сделан не на справочнике, а на правке.
export function applyOverrides(ref: Reference, overrides: LabOverride[]): { ref: Reference; errors: string[] } {
  if (!overrides.length) return { ref, errors: [] }
  const errors: string[] = []
  const mine = overrides.filter(o => ref.params.some(p => p.key === o.key))
  const params = ref.params.map(p => {
    const o = mine.find(x => x.key === p.key)
    if (!o) return p
    if (!(o.lo >= 0 && o.hi >= o.lo)) { errors.push(`${o.key}: нужен диапазон 0 ≤ от ≤ до`); return p }
    return { ...p, lo: o.lo, hi: o.hi, status: 'owner' as const, source: `правка проекта: ${o.note || 'без пояснения'}` }
  })
  const next: Reference = { ...ref, params, changes: [], reason: `${ref.reason} + правки проекта (${mine.length})` }
  return { ref: next, errors: [...errors, ...referenceErrors(next)] }
}

export const unknownOverrideKeys = (refs: Reference[], overrides: LabOverride[]) =>
  overrides.filter(o => !refs.some(r => r.params.some(p => p.key === o.key))).map(o => o.key)
