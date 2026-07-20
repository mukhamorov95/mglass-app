import * as Sentry from '@sentry/nextjs'

// Клиентский Sentry. Файл sentry.client.config.ts в Next 16 больше не
// подхватывается — работает только конвенция instrumentation-client.ts
// (см. node_modules/next/dist/docs/.../instrumentation-client.md).
// Session Replay сознательно выключен: тянул вес на каждой странице.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === 'production',
  tracesSampleRate: 0.1,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
