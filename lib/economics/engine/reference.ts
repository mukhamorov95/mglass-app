import { plus, type Range } from '../classification/vat'
import { fingerprint, weakest, STATUS_LABEL, type Status } from '../values'

// Справочник — плоский список параметров. Значение всегда диапазон (точка: lo = hi); у «нет
// значения» оба края null. Настоящие справочники лежат вне git: репозиторий публичный.
export type Param = {
  key: string
  group: string
  label: string
  unit: string
  lo: number | null
  hi: number | null
  status: Status
  source: string
  date: string
  vat?: number | 'none' | 'unknown'   // для сумм: ставка входного НДС
  vatConfirmed?: boolean
  attrs?: Record<string, string | number>
}

export type Change = {
  key: string
  before: { lo: number | null; hi: number | null; status: Status; source: string }
  after: { lo: number | null; hi: number | null; status: Status; source: string }
}

export type Reference = {
  id: 'tech' | 'finance'
  version: number
  date: string
  author: string
  reason: string
  changes: Change[]
  params: Param[]
}

export function referenceErrors(ref: Reference): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const p of ref.params) {
    if (seen.has(p.key)) errors.push(`${p.key}: параметр задан дважды`)
    seen.add(p.key)
    if (!(p.status in STATUS_LABEL)) errors.push(`${p.key}: неизвестный статус`)
    if (!p.source) errors.push(`${p.key}: не указан источник`)
    const empty = p.lo == null && p.hi == null
    if (empty !== (p.status === 'missing')) errors.push(`${p.key}: пустое значение и статус «нет значения» должны совпадать`)
    if (!empty && !(Number.isFinite(p.lo) && Number.isFinite(p.hi) && p.lo! >= 0 && p.hi! >= p.lo!)) {
      errors.push(`${p.key}: нужен диапазон 0 ≤ от ≤ до`)
    }
  }
  return errors
}

export type Edit = { key: string; lo: number | null; hi: number | null; status: Status; source: string }

// Уточнение создаёт новую версию: прежняя не меняется, в новой записано, что было и почему стало.
export function reviseReference(ref: Reference, edits: Edit[], meta: { reason: string; author: string; date: string }): Reference {
  if (!meta.reason.trim()) throw new Error('Не указана причина изменения')
  if (!edits.length) throw new Error('Нет изменений')
  const changes: Change[] = []
  const params = ref.params.map(p => {
    const e = edits.find(x => x.key === p.key)
    if (!e) return p
    const pick = (x: Param | Edit) => ({ lo: x.lo, hi: x.hi, status: x.status, source: x.source })
    changes.push({ key: p.key, before: pick(p), after: pick(e) })
    return { ...p, ...pick(e), date: meta.date }
  })
  const unknown = edits.filter(e => !ref.params.some(p => p.key === e.key))
  if (unknown.length) throw new Error(`Неизвестные параметры: ${unknown.map(e => e.key).join(', ')}`)
  const next: Reference = { ...ref, version: ref.version + 1, date: meta.date, author: meta.author, reason: meta.reason.trim(), changes, params }
  const errors = referenceErrors(next)
  if (errors.length) throw new Error(errors.join('; '))
  return next
}

export const referenceStamp = (ref: Reference) => `${ref.id}@${ref.version}#${fingerprint(ref.params)}`

// Чтение с памятью о том, на каких статусах стоит результат и чего в справочнике не оказалось.
export function reader(...refs: Reference[]) {
  const map = new Map(refs.flatMap(r => r.params).map(p => [p.key, p]))
  const used = new Set<string>()
  const param = (key: string) => map.get(key) ?? null
  const get = (key: string): Range | null => {
    const p = map.get(key)
    if (!p || p.lo == null || p.hi == null) return null
    used.add(key)
    return { lo: p.lo, hi: p.hi }
  }
  const need = (key: string): Range => {
    const v = get(key)
    if (!v) throw new Error(`Нет обязательного параметра: ${key}`)
    return v
  }
  // Крайние значения по нескольким параметрам: когда неизвестно, какой из них применим.
  const span = (keys: string[]): Range | null => {
    const vs = keys.map(get).filter((v): v is Range => !!v)
    return vs.length ? { lo: Math.min(...vs.map(v => v.lo)), hi: Math.max(...vs.map(v => v.hi)) } : null
  }
  const keys = (prefix: string) => [...map.keys()].filter(k => k.startsWith(prefix))
  const status = () => weakest([...used].map(k => map.get(k)!.status))
  return { param, get, need, span, keys, status, used }
}
export type Reader = ReturnType<typeof reader>

export const total = (...r: (Range | null)[]): Range => plus(...r.filter((x): x is Range => !!x))
