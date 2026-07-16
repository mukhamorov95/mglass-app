import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === 'production',
  tracesSampleRate: 0.1,
  // Session Replay снят с клиента: session-sample был 0, но интеграция всё равно
  // тянула вес на КАЖДОЙ странице. Ошибки по-прежнему ловятся (без видеозаписи сессии).
})
