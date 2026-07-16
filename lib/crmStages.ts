// Единая воронка CRM (полный путь, как в AmoCRM). Канон — SYSTEM.md.
// Используется и доской /crm, и карточкой /crm/[id]. Порядок = движение слева направо.

export type CrmZone = { zone: string; tone: string; stages: string[] }

export const CRM_ZONES: CrmZone[] = [
  {
    zone: 'Квалификация', tone: 'text-sky-700', stages: [
      'Получена новая заявка',
      'Назначен ответственный',
      'Проработка',
      'Разговор состоялся',
      'Долгострой',
      'Готов купить',
    ],
  },
  {
    zone: 'Продажа', tone: 'text-amber-700', stages: [
      'Замер назначен',
      'Замер проведён',
      'Согласование после замера',
      'Чертежи в работу',
      'Согласование после отправки чертежей',
      'КП отправлено',
      'Счёт выставлен — ждём оплату',
    ],
  },
  {
    zone: 'Производство', tone: 'text-emerald-700', stages: [
      'Оплата сделана, чертежи не готовы',
      'Оплата получена, проверка чертежей',
      'Счёт оплачен',
      'Заказ в работе',
      'Готово к монтажу',
      'Монтаж назначен',
      'Монтаж начат / в процессе',
      'Рекламация',
      'Оплата остатка',
      'Оплата дизайнером',
    ],
  },
]

export const CRM_STAGES = CRM_ZONES.flatMap(z => z.stages)

export const FIRST_STAGE = 'Получена новая заявка'
export const ASSIGNED_STAGE = 'Назначен ответственный'
export const WON_STAGE = 'Успешно реализовано'
export const LOST_STAGE = 'Не реализовано'

// Прогресс по воронке: 0% на входе → 100% на «Успешно реализовано».
export function stageProgress(stage: string, status: 'active' | 'won' | 'lost'):
  { percent: number; index: number; total: number; lost: boolean; label: string } {
  const path = [...CRM_STAGES, WON_STAGE]
  const total = path.length
  if (status === 'lost') return { percent: 0, index: -1, total, lost: true, label: LOST_STAGE }
  if (status === 'won')  return { percent: 100, index: total - 1, total, lost: false, label: WON_STAGE }
  const i = CRM_STAGES.indexOf(stage)
  const index = i >= 0 ? i : 0
  const percent = Math.round((index / (total - 1)) * 100)
  return { percent, index, total, lost: false, label: stage }
}
