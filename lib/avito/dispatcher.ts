// Диспетчер автономного бота: на каждом сообщении решает, что делать с заявкой.
// Робот работает ТОЛЬКО зону «Квалификация» и ведёт лид к терминалу «Закрыт на замер».
// Чистая, тестируемая функция — решение детерминированно из флагов (не из модели).

import { scoreLead, type LeadScore } from './scoreLead'
import { type LeadFlags } from './flags'

export type DispatchAction =
  | 'disqualify'     // не наш профиль / отказ / спам → в потерю
  | 'close_measure'  // закрыт на замер → этап «Замер назначен», передача человеку
  | 'park'           // клиент отложил → «Долгострой» + задача-себе с датой
  | 'collect'        // добираем недостающий флаг, ведём дальше

export type Dispatch = {
  action: DispatchAction
  stage: string | null   // целевой этап воронки (null = не менять)
  toLost: boolean        // перевести лид в status='lost'
  handoff: boolean       // передать человеку (бот замолкает)
  reason: string
  score: LeadScore
}

// Целевые этапы — канон lib/crmStages.ts.
const STAGE_PARK = 'Долгострой'
const STAGE_MEASURE = 'Замер назначен'

export function decideNextAction(flags: LeadFlags): Dispatch {
  const score = scoreLead(flags)

  if (score.disqualified)
    return { action: 'disqualify', stage: null, toLost: true, handoff: true, reason: score.reason, score }

  if (score.measureClosed)
    return { action: 'close_measure', stage: STAGE_MEASURE, toLost: false, handoff: true, reason: 'закрыт на замер (согласие+телефон+адрес+готовность)', score }

  if (flags.stall)
    return { action: 'park', stage: STAGE_PARK, toLost: false, handoff: false, reason: 'клиент отложил — ставим задачу-себе и ведём по триггеру', score }

  return { action: 'collect', stage: null, toLost: false, handoff: false, reason: `добираем: ${score.missingNext ?? 'финальные детали'}`, score }
}
