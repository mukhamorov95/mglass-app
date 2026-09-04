// Этаж и деньги сделки — ОДНА логика для доски и для карточки.
//
// Раньше их было две: доска считала по всем артефактам (КП, договор, оплаты),
// а карточка — только по расчётам. Сделка с подписанным договором на 775 000
// показывалась на доске как «Договор · 775 000 ₽», а в своей же карточке как
// «Новая · 0 ₽». Расхождение двух экранов об одной сделке — хуже, чем любая
// из двух версий по отдельности, поэтому правда теперь здесь одна.
//
// Статус НЕ хранится: он производная от того, что в сделке реально появилось.

export type DealArtifacts = {
  calcCount: number
  calcMax: number            // самый дорогой расчёт
  hasSentCalc: boolean       // расчёт отправлен/согласован — считаем как КП
  kpCount: number
  kpTotal: number            // последнее КП
  contractCount: number
  contractTotal: number      // последний договор
  paid: number
  payCount: number
}

export type DealStageKey = 'new' | 'quote' | 'kp' | 'contract' | 'pay' | 'done'
export type DealStage = { key: DealStageKey; label: string; tone: 'plain' | 'sent' | 'warn' | 'good' }

export const DEAL_STAGES: { key: DealStageKey; label: string }[] = [
  { key: 'new',      label: 'Новая' },
  { key: 'quote',    label: 'Просчёт' },
  { key: 'kp',       label: 'КП отправлено' },
  { key: 'contract', label: 'Договор' },
  { key: 'pay',      label: 'Оплата' },
  { key: 'done',     label: 'Готово' },
]

const TONE: Record<DealStageKey, DealStage['tone']> = {
  new: 'plain', quote: 'plain', kp: 'sent', contract: 'warn', pay: 'warn', done: 'good',
}

export const emptyArtifacts = (): DealArtifacts => ({
  calcCount: 0, calcMax: 0, hasSentCalc: false,
  kpCount: 0, kpTotal: 0, contractCount: 0, contractTotal: 0, paid: 0, payCount: 0,
})

// Ценность сделки: договор → последнее КП → самый дорогой расчёт.
export function dealValue(a: DealArtifacts) {
  const value = a.contractTotal || a.kpTotal || a.calcMax
  const paid = a.paid
  return { value, paid, remaining: Math.max(0, value - paid) }
}

// Этаж = самый дальний достигнутый артефакт на пути денег.
export function dealStageKey(a: DealArtifacts): DealStageKey {
  const { value, paid } = dealValue(a)
  let key: DealStageKey = 'new'
  if (a.calcCount > 0) key = 'quote'
  if (a.kpCount > 0 || a.hasSentCalc) key = 'kp'
  if (a.contractCount > 0) key = 'contract'
  if (a.payCount > 0) key = 'pay'
  // «Готово» — деньги получены полностью, а не ручная отметка.
  if (a.payCount > 0 && value > 0 && paid >= value - 1) key = 'done'
  return key
}

export function dealStage(a: DealArtifacts): DealStage {
  const key = dealStageKey(a)
  return { key, label: DEAL_STAGES.find(s => s.key === key)!.label, tone: TONE[key] }
}
