// Реестр паспортов. Проверка — на импорте: битая деталь до сцены не доходит,
// вместо неё остаётся старая рисованная форма, а причина видна на стенде.
// Новая деталь = один импорт в этом файле, больше ничего трогать не нужно.

import type { PartSpec, PartIssue } from './types'
import { validatePart } from './validate'
import { SD_210_L230 } from './catalog/sd-210'

const DECLARED: PartSpec[] = [
  SD_210_L230,
]

const accepted = new Map<string, PartSpec>()
const rejected: { spec: PartSpec; issues: PartIssue[] }[] = []
const dupes: string[] = []

for (const spec of DECLARED) {
  const issues = validatePart(spec)
  if (issues.length) { rejected.push({ spec, issues }); continue }
  if (accepted.has(spec.id)) { dupes.push(spec.id); continue }
  accepted.set(spec.id, spec)
}

export const getPart = (id?: string | null): PartSpec | null => (id ? accepted.get(id) ?? null : null)
export const allParts = (): PartSpec[] => [...accepted.values()]
export const partProblems = () => ({ rejected, dupes })
