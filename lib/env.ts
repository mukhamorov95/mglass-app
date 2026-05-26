// ENV validation — called at server startup.
// Critical vars throw (server won't start). Optional vars warn (feature disabled).

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`[env] Missing required ENV variable: ${name}`)
  return val
}

function warnEnv(name: string, feature: string) {
  if (!process.env[name]) {
    console.warn(`[env] ${name} not set — ${feature} will be disabled`)
  }
}

// ─── Critical: server won't function without these ────────────────────────────
export function validateCriticalEnv() {
  requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  requireEnv('SUPABASE_SERVICE_ROLE_KEY')
}

// ─── Optional: warn once at startup, feature gracefully disabled ──────────────
export function warnOptionalEnv() {
  warnEnv('ANTHROPIC_API_KEY',    'AI features (AI Control Center, agents, KP generator)')
  warnEnv('RESEND_API_KEY',       'email notifications (order approvals, low margin alerts)')
  warnEnv('TELEGRAM_BOT_TOKEN',   'Telegram bot (Vladislav AI, admin notifications)')
  warnEnv('CRON_SECRET',          'cron jobs (health check, agents, stock alerts)')
  warnEnv('WAZZUP_API_KEY',       'WhatsApp integration (AMO webhook auto-replies)')
}

// ─── Convenience: check single optional key at call site ─────────────────────
export function hasEnv(name: string): boolean {
  return Boolean(process.env[name])
}
