import type { Param, Edit, Reference } from '../engine/reference'
import { STATUS_LABEL, type Status } from '../values'

// Разбор правок, пришедших с экрана: строки из полей ввода → проверенные изменения справочника.
// Отдельно от маршрута, потому что здесь вся арифметика смысла: что считается изменением, что
// пустым значением, и какие сочетания отклоняются с объяснением вместо молчаливой подстановки.
export type Incoming = { lo?: string | number | null; hi?: string | number | null; status?: string; source?: string }

const num = (x: unknown): number | null | 'bad' => {
  if (x == null || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : 'bad'
}

export function toEdits(ref: Reference, incoming: Record<string, Incoming>): { edits: Edit[]; error: string | null } {
  const edits: Edit[] = []
  for (const [key, v] of Object.entries(incoming)) {
    const p: Param | undefined = ref.params.find(x => x.key === key)
    if (!p) return { edits: [], error: `Нет такого норматива: ${key}` }
    const lo = num(v.lo), hi = num(v.hi)
    if (lo === 'bad' || hi === 'bad') return { edits: [], error: `${p.label}: значение не число` }
    const empty = lo == null && hi == null
    if (!empty && (lo == null || hi == null)) {
      return { edits: [], error: `${p.label}: нужны оба края диапазона — точное значение пишется в оба` }
    }
    if (!empty && !(lo! >= 0 && hi! >= lo!)) return { edits: [], error: `${p.label}: нужен диапазон 0 ≤ от ≤ до` }
    const asked = v.status && v.status in STATUS_LABEL ? (v.status as Status) : null
    // Пустое значение — всегда «нет значения»: ноль вместо неизвестного здесь не появляется.
    const status: Status = empty ? 'missing' : (asked && asked !== 'missing' ? asked : 'owner')
    if (!empty && asked === 'missing') {
      return { edits: [], error: `${p.label}: статус «нет значения» и само значение не сходятся` }
    }
    const source = (v.source ?? '').trim() || p.source
    if (!source) return { edits: [], error: `${p.label}: не указан источник` }
    if (lo === p.lo && hi === p.hi && status === p.status && source === p.source) continue
    edits.push({ key, lo, hi, status, source })
  }
  return { edits, error: null }
}
