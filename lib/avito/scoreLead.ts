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
  isHot: boolean             // сработало правило «горячий, следим»
  measureClosed: boolean     // «Закрыт на замер» — терминал робота, передача человеку
  disqualified: boolean      // есть дисквалифицирующий флаг
  coreDone: number           // сколько ядровых флагов собрано
  coreTotal: number
  missingNext: FlagKey | null // какой флаг боту добывать следующим (по ASK_ORDER)
  reason: string             // человекочитаемое объяснение светофора
}

const TOTAL_POSITIVE_WEIGHT = POSITIVE_FLAGS.reduce((s, f) => s + f.weight, 0)

// Флаг считается собранным с учётом старых карточек: до 17.09 готовность объекта
// писалась в object_ready, отдельного finish_known не было.
function has(flags: LeadFlags, k: FlagKey): boolean {
  if (k === 'finish_known') return !!flags.finish_known || !!flags.object_ready
  return !!flags[k]
}

/**
 * Когда клиент уходит менеджеру (решение владельца 17.09.2026), бот не тянет дальше:
 * — собран портрет: изделие + размеры + известно про чистовую + телефон;
 * — клиент спросил цену, и понятны изделие и размеры: цену считает только менеджер,
 *   а дальнейшие вопросы бота на этом месте теряли клиентов;
 * — клиент сам готов на замер и дал телефон.
 */
export function scoreLead(flags: LeadFlags): LeadScore {
  const disqualified = DISQUALIFY_KEYS.some(k => flags[k])
  const coreTotal = CORE_KEYS.length
  const coreDone = CORE_KEYS.filter(k => has(flags, k)).length

  const setWeight = POSITIVE_FLAGS.filter(f => has(flags, f.key)).reduce((s, f) => s + f.weight, 0)
  const readiness = disqualified || TOTAL_POSITIVE_WEIGHT === 0
    ? 0
    : Math.min(100, Math.round((100 * setWeight) / TOTAL_POSITIVE_WEIGHT))

  const portrait = coreDone === coreTotal
  const priceTrack = !!flags.price_asked && !!flags.product && !!flags.sizes
  const measureTrack = !!flags.ready_measure && !!flags.contact
  const isHot = !disqualified && (portrait || priceTrack || measureTrack)

  const measureClosed = !disqualified && !!flags.measure_agreed && !!flags.contact
    && !!flags.address_known && !!flags.object_ready

  let heat: Heat = 'cold'
  if (!disqualified) {
    if (isHot) heat = 'hot'
    else if (readiness > 0) heat = 'warm'
  }

  const missingNext = disqualified || isHot ? null : (ASK_ORDER.find(k => !has(flags, k)) ?? null)

  const reason = disqualified
    ? 'дисквалификация (не наш профиль / отказ / спам)'
    : portrait ? 'собран портрет клиента'
      : priceTrack ? 'спросил цену — считает менеджер'
        : measureTrack ? 'готов на замер + телефон'
          : heat === 'warm' ? `портрет ${coreDone}/${coreTotal}` : 'новый лид'

  return { readiness, heat, isHot, measureClosed, disqualified, coreDone, coreTotal, missingNext, reason }
}
