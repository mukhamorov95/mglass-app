// Типы и справочники рекомендаций — отдельно от генерации, чтобы экран не тянул
// в браузер SDK модели.

export type RecStatus = 'new' | 'in_work' | 'done' | 'archived' | 'removed'
export type RecPriority = 'critical' | 'high' | 'medium' | 'low'

export type Recommendation = {
  id: string
  title: string
  priority: RecPriority
  category: string | null
  problem: string | null
  impact: string | null
  action: string | null
  metric: string | null
  perspective: string | null
  status: RecStatus
  source: string | null
  created_at: string
  decided_at: string | null
  decided_by: string | null
  result_note: string | null
  done_at: string | null
  // Колонки из supabase/migrations/20261006_ai_recommendations_evidence.sql; до неё — undefined.
  evidence?: RecEvidence | null
  recheck?: RecRecheck | null
  recheck_at?: string | null
}

// Цифра, на которую опирается рекомендация: значение считает код, модель только
// ссылается на id. id относительный («прошлый месяц»), чтобы сверка через месяц
// посчитала ту же метрику за новый период.
export type FactUnit = 'rub' | 'pct' | 'count'
export type Fact = { id: string; label: string; value: number; unit: FactUnit; period: string; source: string }

export type RecEvidence = {
  facts: Fact[]
  check: string | null       // какую цифру сверить после «сделано»
  unverified: string[]       // числа из текста модели, которых нет в данных
}

export type RecRecheck = {
  at: string
  items: { id: string; label: string; unit: FactUnit; before: number; beforePeriod: string; after: number | null; afterPeriod: string | null }[]
}

export function formatFactValue(value: number, unit: FactUnit): string {
  if (unit === 'pct') return `${(Math.round(value * 10) / 10).toLocaleString('ru-RU')} %`
  if (unit === 'rub') return `${Math.round(value).toLocaleString('ru-RU')} ₽`
  return Math.round(value).toLocaleString('ru-RU')
}

export const factLine = (f: Pick<Fact, 'label' | 'value' | 'unit' | 'period'>) => `${f.label}: ${formatFactValue(f.value, f.unit)} (${f.period})`

export const PERSPECTIVES = [
  { id: 'ceo',       label: 'Собственник' },
  { id: 'sales',     label: 'Руководитель продаж' },
  { id: 'analyst',   label: 'Системный аналитик' },
  { id: 'erp',       label: 'Производство и склад' },
  { id: 'marketing', label: 'Маркетинг' },
] as const

export const REC_STATUS_LABEL: Record<RecStatus, string> = {
  new: 'Ждёт решения', in_work: 'В работе', done: 'Сделано', archived: 'В архиве', removed: 'Убрано',
}
