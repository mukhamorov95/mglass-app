// Ворота вебхуков Авито: путь в белом списке middleware, а пишет service-role'ом,
// поэтому без секрета маршрут закрыт (503), а не открыт для всех, как при «если секрет задан».
export type WebhookGateFail = { status: 403 | 503; error: 'forbidden' | 'not configured' }

export function webhookGate(secret: string | undefined, key: string | null): WebhookGateFail | null {
  if (!secret) return { status: 503, error: 'not configured' }
  if (key !== secret) return { status: 403, error: 'forbidden' }
  return null
}
