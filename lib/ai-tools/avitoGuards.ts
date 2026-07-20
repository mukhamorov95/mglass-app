// Ф2: защита ответов Ивана. Чистая логика без сети — покрыта тестами.
// Задача: сделать так, чтобы клиент физически не мог получить выдуманную цену,
// чтобы серия сообщений подряд не порождала серию ответов, и чтобы телефон
// не терялся, если модель его не заметила.

export type DialogMsg = { from: 'client' | 'manager'; text: string }

// Телефон РФ в свободном тексте: +7/8/7 + 10 цифр с любыми разделителями.
export function extractPhone(text: string): string | null {
  const digitsOnly = text.replace(/[^\d+]/g, ' ')
  const m = /(?:\+?7|8)?\s*\(?(\d{3})\)?\s*(\d{3})\s*(\d{2})\s*(\d{2})/.exec(digitsOnly)
  if (!m) return null
  const code = m[1]
  // Не мобильный/городской код — скорее всего это размеры или сумма, а не телефон
  if (code.startsWith('0')) return null
  const digits = `${code}${m[2]}${m[3]}${m[4]}`
  if (/^(\d)\1{9}$/.test(digits)) return null
  return `+7${digits}`
}

// Клиент часто пишет очередью: «привет» / «нужна душевая» / «800 на 2000».
// Отвечать надо один раз на всё сразу — склеиваем хвост подряд идущих реплик.
export function mergeClientBurst(history: DialogMsg[]): DialogMsg[] {
  const out: DialogMsg[] = []
  for (const m of history) {
    const prev = out[out.length - 1]
    if (prev && prev.from === m.from) prev.text = `${prev.text}\n${m.text}`
    else out.push({ ...m })
  }
  return out
}

// Числа, похожие на цену: 4+ цифр либо с явной валютой. Размеры (800, 2000)
// и годы под это не попадают, если рядом нет рубля.
const PRICE_RE = /(\d[\d\s  ]{2,})\s*(?:₽|руб\.?|рублей|р\.)|(?:^|[^\d])(\d{2,3}[\s ]\d{3})(?![\d\s]*(?:мм|см|м\b))/gi

const norm = (s: string) => Number(s.replace(/[^\d]/g, ''))

// Разрешаем только те суммы, что посчитал калькулятор (±1 ₽ на округление),
// и «мелочь» до 3000 ₽ — это доставка/подъём, их модель называет по прайсу.
export function guardPrices(reply: string, allowed: number[]): { text: string; replaced: number } {
  const ok = new Set(allowed.map(a => Math.round(a)))
  let replaced = 0
  const text = reply.replace(PRICE_RE, (full, a: string | undefined, b: string | undefined) => {
    const value = norm(a ?? b ?? '')
    if (!value || value < 3000) return full
    for (const x of ok) if (Math.abs(x - value) <= 1) return full
    replaced++
    return 'уточню точную сумму и напишу'
  })
  return { text, replaced }
}

// Диалог не должен крутиться бесконечно: после этого числа реплик бота
// подключается человек, даже если модель считает, что справляется.
export const MAX_BOT_REPLIES = 12

export function shouldHandOver(history: DialogMsg[]): boolean {
  return history.filter(m => m.from === 'manager').length >= MAX_BOT_REPLIES
}
