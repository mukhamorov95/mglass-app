import { validateCriticalEnv, warnOptionalEnv } from '@/lib/env'
import * as Sentry from '@sentry/nextjs'

// До 2026-07-20 register() только валидировал env — sentry.server/edge.config
// никем не импортировались, и серверный Sentry не работал ни дня.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    validateCriticalEnv()
    warnOptionalEnv()
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
