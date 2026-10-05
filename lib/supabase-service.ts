// lib/supabase-service.ts
//
// Server-only Supabase client using SERVICE_ROLE_KEY.
// Import ONLY in server code: API routes, server actions, lib/ai-tools/.
// NEVER import in client components, hooks, or browser-side code.
//
// Service role bypasses RLS — app-level auth checks (getRole, getUser)
// must be enforced by the caller before any write operation.

import { createClient } from '@supabase/supabase-js'

// actor — id проверенного пользователя, от чьего имени сервер пишет: триггер журнала
// (activity_log, миграция 20261006_margin_edits_audit) берёт автора из заголовка
// x-mglass-actor, потому что у service-ключа своего пользователя нет. Без actor —
// запись «системы» (кроны, сверки книг). Получить клиент с автором — lib/serviceAs.ts.
export function createServiceClient(opts?: { actor?: string | null }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      '[supabase-service] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. ' +
      'This file is server-only — do not import in client components.'
    )
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(opts?.actor ? { global: { headers: { 'x-mglass-actor': opts.actor } } } : {}),
  })
}
