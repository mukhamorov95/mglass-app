import { hasDiameterSign } from '@/lib/production/holes'

// Чистая часть лога разбора: сама запись живёт в parseLog.ts с `server-only`,
// а эти два счётчика должны быть проверяемы тестом без серверного окружения.

// Сколько распознанных деталей несут отверстия и сколько — диаметр в тексте.
// Именно эти два числа отличают «разбор не запускали» от «запускали, и в чертеже
// диаметров не было» — вопрос, на который 02.09.2026 ответить было нечем.
export function countHoleSignals(items: unknown): { withHoles: number; withDiameter: number } {
  if (!Array.isArray(items)) return { withHoles: 0, withDiameter: 0 }
  let withHoles = 0, withDiameter = 0
  for (const raw of items) {
    const it = raw as Record<string, unknown> | null
    if (!it || typeof it !== 'object') continue
    if ((Number(it.holes) || 0) > 0) withHoles++
    const text = [it.notes, it.comment, it.label].filter(v => typeof v === 'string').join(' ')
    if (hasDiameterSign(text)) withDiameter++
  }
  return { withHoles, withDiameter }
}
