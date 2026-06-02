// lib/supabase-service.ts
//
// Server-only Supabase client using SERVICE_ROLE_KEY.
// Import ONLY in server code: API routes, server actions, lib/ai-tools/.
// NEVER import in client components, hooks, or browser-side code.
//
// Service role bypasses RLS — app-level auth checks (getRole, getUser)
// must be enforced by the caller before any write operation.

import { createClient } from '@supabase/supabase-js'

export function createServiceClient() {
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
  })
}
