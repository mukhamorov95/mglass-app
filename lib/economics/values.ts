// Статус входного значения. Результат расчёта получает самый слабый статус из своих входов;
// «нет значения» нулём не заменяется.
export type Status = 'document' | 'measured' | 'owner' | 'hypothesis' | 'missing'

export const STATUS_LABEL: Record<Status, string> = {
  document: 'документ', measured: 'измерено', owner: 'владелец', hypothesis: 'гипотеза', missing: 'нет значения',
}
const RANK: Record<Status, number> = { document: 0, measured: 1, owner: 2, hypothesis: 3, missing: 4 }

export const weakest = (statuses: Status[]): Status =>
  statuses.reduce<Status>((a, b) => (RANK[b] > RANK[a] ? b : a), 'document')

export type Meta = { status: Status; source: string; date: string }
export type Valued = Meta & { value: number | null }

export const valuedError = (v: Valued, name: string): string | null =>
  !v.source ? `${name}: не указан источник`
  : (v.value == null) !== (v.status === 'missing') ? `${name}: пустое значение и статус «нет значения» должны совпадать`
  : null

// Отпечаток набора входов: по нему видно, на каких нормах и расходах получен результат.
export function fingerprint(x: unknown): string {
  let h = 0x811c9dc5
  for (const c of JSON.stringify(x)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}
