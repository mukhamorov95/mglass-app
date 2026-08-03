// Детерминированный скоринг заявки Авито по флажкам.
// ВАЖНО: решение «отдать человеку» принимает эта функция (код), а не модель —
// прозрачно, воспроизводимо, тестируемо. Модельный score остаётся как «мнение».

import {
  POSITIVE_FLAGS, CORE_KEYS, DISQUALIFY_KEYS, ASK_ORDER,
  type FlagKey, type LeadFlags,
} from './flags'

export type Heat = 'cold' | 'warm' | 'hot'

export type LeadScore = {
  readiness: number          // 0..100 — доля собранного «веса» положительных флагов
  heat: Heat                 // cold → бот молчит | warm → бот добирает | hot → человеку
  isHot: boolean             // сработало правило «отдать человеку»
  disqualified: boolean      // есть дисквалифицирующий флаг
  coreDone: number           // сколько ядровых флагов собрано
  coreTotal: number
  missingNext: FlagKey | null // какой флаг боту добывать следующим (по ASK_ORDER)
  reason: string             // человекочитаемое объяснение светофора
}

const TOTAL_POSITIVE_WEIGHT = POSITIVE_FLAGS.reduce((s, f) => s + f.weight, 0)

/**
 * Правило 🟢 (из решения владельца): лид уходит человеку, если собрано ВСЁ ядро
 * (продукт + размеры + место + телефон), ИЛИ клиент прямо готов на замер и дал
 * телефон (быстрый путь — не мучаем сбором остального).
 */
export function scoreLead(flags: LeadFlags): LeadScore {
  const disqualified = DISQUALIFY_KEYS.some(k => flags[k])
  const coreTotal = CORE_KEYS.length
  const coreDone = CORE_KEYS.filter(k => flags[k]).length

  const setWeight = POSITIVE_FLAGS.filter(f => flags[f.key]).reduce((s, f) => s + f.weight, 0)
  const readiness = disqualified || TOTAL_POSITIVE_WEIGHT === 0
    ? 0
    : Math.round((100 * setWeight) / TOTAL_POSITIVE_WEIGHT)

  const allCore = coreDone === coreTotal
  const measureFastTrack = !!flags.ready_measure && !!flags.contact
  const isHot = !disqualified && (allCore || measureFastTrack)

  let heat: Heat = 'cold'
  if (!disqualified) {
    if (isHot) heat = 'hot'
    else if (readiness > 0) heat = 'warm'
  }

  const missingNext = disqualified || isHot ? null : (ASK_ORDER.find(k => !flags[k]) ?? null)

  const reason = disqualified
    ? 'дисквалификация (не наш профиль / отказ / спам)'
    : isHot
      ? (allCore ? 'собрано ядро заявки' : 'готов на замер + телефон')
      : heat === 'warm'
        ? `в работе бота: собрано ядра ${coreDone}/${coreTotal}`
        : 'новый/сырой лид'

  return { readiness, heat, isHot, disqualified, coreDone, coreTotal, missingNext, reason }
}
