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
}

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
