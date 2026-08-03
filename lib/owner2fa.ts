import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'
import { sendMessage } from '@/lib/telegram'

// Второй фактор входа под владельцем. Код — 6 цифр, живёт 5 минут, хранится
// хешем в owner_login_codes. Доставка — в личный Telegram владельца. Резервный
// код (OWNER_2FA_RECOVERY) — аварийный вход, если телефон/бот недоступны.

const CODE_TTL_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5
const RESEND_GUARD_MS = 45 * 1000

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function gen6(): string {
  // 6 цифр из криптостойкого источника (без Math.random).
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return String(arr[0] % 1_000_000).padStart(6, '0')
}

async function ownerTelegramId(userId: string): Promise<number | null> {
  const svc = createServiceClient()
  const { data } = await svc.from('telegram_users').select('telegram_id').eq('user_id', userId).maybeSingle()
  const id = (data as { telegram_id?: number } | null)?.telegram_id
  return typeof id === 'number' ? id : null
}

export type SendResult = { ok: true } | { ok: false; reason: 'no_telegram' | 'throttled' | 'send_failed' }

// Сгенерировать и отправить код. Anti-spam: не чаще одного кода в RESEND_GUARD_MS.
export async function sendOwner2faCode(userId: string): Promise<SendResult> {
  const svc = createServiceClient()
  const { data: existing } = await svc.from('owner_login_codes')
    .select('created_at').eq('user_id', userId).maybeSingle()
  if (existing?.created_at && Date.now() - new Date(existing.created_at).getTime() < RESEND_GUARD_MS) {
    return { ok: false, reason: 'throttled' }
  }

  const tgId = await ownerTelegramId(userId)
  if (tgId == null) return { ok: false, reason: 'no_telegram' }

  const code = gen6()
  const codeHash = await sha256(code)
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()
  await svc.from('owner_login_codes').upsert({
    user_id: userId, code_hash: codeHash, expires_at: expiresAt, attempts: 0, created_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  try {
    await sendMessage(tgId,
      `🔐 Код входа M-Glass: <b>${code}</b>\nДействует 5 минут.\n\n` +
      `Если вы НЕ входите в систему прямо сейчас — кто-то знает пароль от админа. ` +
      `Никому не сообщайте код и срочно смените пароль.`)
  } catch {
    return { ok: false, reason: 'send_failed' }
  }
  return { ok: true }
}

export type VerifyResult = { ok: true; via: 'code' | 'recovery' } | { ok: false; reason: 'no_code' | 'expired' | 'too_many' | 'mismatch' }

// Проверить код (или резервный). Резервный код сверяем за постоянное время.
export async function verifyOwner2faCode(userId: string, input: string): Promise<VerifyResult> {
  const clean = (input || '').trim()

  const recovery = process.env.OWNER_2FA_RECOVERY
  if (recovery && clean.length === recovery.length) {
    let diff = 0
    for (let i = 0; i < recovery.length; i++) diff |= recovery.charCodeAt(i) ^ clean.charCodeAt(i)
    if (diff === 0) return { ok: true, via: 'recovery' }
  }

  const svc = createServiceClient()
  const { data: row } = await svc.from('owner_login_codes')
    .select('code_hash, expires_at, attempts').eq('user_id', userId).maybeSingle()
  if (!row) return { ok: false, reason: 'no_code' }
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' }
  if ((row.attempts ?? 0) >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many' }

  const inputHash = await sha256(clean)
  if (inputHash !== row.code_hash) {
    await svc.from('owner_login_codes').update({ attempts: (row.attempts ?? 0) + 1 }).eq('user_id', userId)
    return { ok: false, reason: 'mismatch' }
  }

  // Успех — код одноразовый, гасим.
  await svc.from('owner_login_codes').delete().eq('user_id', userId)
  return { ok: true, via: 'code' }
}
