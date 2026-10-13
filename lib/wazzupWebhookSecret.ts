import { createHmac, timingSafeEqual } from 'crypto'

// Wazzup не подписывает вызовы вебхука — секрет живёт в адресе (?secret=). Отдельной
// переменной окружения на проде нет, поэтому по умолчанию секрет выводится из ключа API:
// его знаем только мы и Wazzup. WAZZUP_WEBHOOK_SECRET, если задан, важнее.
export function wazzupWebhookSecret(env: { WAZZUP_WEBHOOK_SECRET?: string; WAZZUP_API_KEY?: string }): string | null {
  if (env.WAZZUP_WEBHOOK_SECRET) return env.WAZZUP_WEBHOOK_SECRET
  if (!env.WAZZUP_API_KEY) return null
  return createHmac('sha256', env.WAZZUP_API_KEY).update('mglass-wazzup-webhook').digest('hex').slice(0, 32)
}

export type SecretCheck = 'ok' | 'missing' | 'bad' | 'unconfigured'

export function checkWazzupSecret(provided: string | null, expected: string | null): SecretCheck {
  if (!expected) return 'unconfigured'
  if (!provided) return 'missing'
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'bad'
}
