// Проверка опоры рекомендации на данные. Модель называет id цифр, на которых держится
// вывод; код берёт значения из своих данных и отмечает числа в тексте, которых в
// данных нет. Чистые функции — ради тестов.

import type { Fact, RecEvidence } from './recommendationTypes'

const MAX_EVIDENCE = 4

export function pickEvidence(ids: unknown, check: unknown, byId: Map<string, Fact>): RecEvidence | null {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  const facts = [...new Set(list)].map(id => byId.get(id)).filter((f): f is Fact => !!f).slice(0, MAX_EVIDENCE)
  if (!facts.length) return null
  const checkId = typeof check === 'string' && facts.some(f => f.id === check) ? check : facts[0].id
  return { facts, check: checkId, unverified: [] }
}

// «2 799 787», «2,8 млн», «36,7%», «119». Годы и сроки («2026», «30 дней») — не данные.
const NUM = /(\d{1,3}(?:[  ]\d{3})+|\d+(?:[.,]\d+)?)(\s*(?:млн|тыс\.?|%))?/g
const TIME_AFTER = /^\s*(дн|день|дня|дней|недел|мес|час|мин|год|лет|раз|рабоч|календар|сек)/i

export function unverifiedNumbers(text: string | null | undefined, facts: Fact[]): string[] {
  if (!text) return []
  const out: string[] = []
  for (const m of text.matchAll(NUM)) {
    const raw = m[1], suffix = (m[2] ?? '').trim()
    const after = text.slice((m.index ?? 0) + m[0].length)
    if (!suffix && TIME_AFTER.test(after)) continue
    let n = Number(raw.replace(/[  ]/g, '').replace(',', '.'))
    if (!Number.isFinite(n)) continue
    if (!suffix && n >= 2000 && n <= 2100 && Number.isInteger(n)) continue
    if (suffix.startsWith('млн')) n *= 1_000_000
    else if (suffix.startsWith('тыс')) n *= 1_000
    // «2,8 млн» и «130 тыс» — заведомо округлённые: допуск шире.
    if (!matchesData(n, suffix === '%', facts, suffix && suffix !== '%' ? 0.03 : 0.01)) out.push(m[0].trim())
  }
  return [...new Set(out)]
}

const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= Math.max(0.6, Math.abs(b) * tol)

// Число из данных: сама цифра, её доля от другой цифры той же единицы или изменение
// между двумя такими цифрами («4,2%» = 5 из 119, «−40%» = сентябрь к августу).
function matchesData(n: number, isPct: boolean, facts: Fact[], tol: number): boolean {
  if (facts.some(f => near(n, f.value, tol) && (isPct ? f.unit === 'pct' : f.unit !== 'pct'))) return true
  if (!isPct) return false
  for (const a of facts) for (const b of facts) {
    if (a === b || a.unit !== b.unit || a.unit === 'pct' || !b.value) continue
    if (near(n, a.value / b.value * 100) || near(Math.abs(n), Math.abs((a.value - b.value) / b.value * 100))) return true
  }
  return false
}
