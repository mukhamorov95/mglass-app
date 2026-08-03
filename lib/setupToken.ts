import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'

// Одноразовые токены установки пароля. Пользователь задаёт пароль сам по ссылке,
// админ его не вводит и не знает — пароль не проходит через браузер владельца и
// не пишется в БД открытым текстом. Токен хранится хешем (sha-256), TTL 7 дней.

const TTL_MS = 7 * 24 * 60 * 60 * 1000

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function randomToken(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Выдать свежий токен для пользователя. Прежние неиспользованные — гасим, чтобы
// работала только последняя присланная ссылка.
export async function createSetupToken(userId: string): Promise<string> {
  const svc = createServiceClient()
  await svc.from('user_setup_tokens').delete().eq('user_id', userId).is('used_at', null)
  const token = randomToken()
  const tokenHash = await sha256(token)
  await svc.from('user_setup_tokens').insert({
    token_hash: tokenHash, user_id: userId,
    expires_at: new Date(Date.now() + TTL_MS).toISOString(),
  })
  return token
}

// Проверить токен без побочных эффектов — вернуть user_id или null.
export async function verifySetupToken(token: string): Promise<string | null> {
  const clean = (token || '').trim()
  if (!/^[0-9a-f]{64}$/.test(clean)) return null
  const svc = createServiceClient()
  const tokenHash = await sha256(clean)
  const { data } = await svc.from('user_setup_tokens')
    .select('user_id, expires_at, used_at').eq('token_hash', tokenHash).maybeSingle()
  if (!data || data.used_at) return null
  if (new Date(data.expires_at).getTime() < Date.now()) return null
  return data.user_id as string
}

// Пометить токен использованным (после успешной установки пароля).
export async function markSetupTokenUsed(token: string): Promise<void> {
  const clean = (token || '').trim()
  if (!/^[0-9a-f]{64}$/.test(clean)) return
  const svc = createServiceClient()
  const tokenHash = await sha256(clean)
  await svc.from('user_setup_tokens').update({ used_at: new Date().toISOString() }).eq('token_hash', tokenHash)
}
