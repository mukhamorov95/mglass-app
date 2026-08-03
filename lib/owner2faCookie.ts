// Подпись/проверка куки owner-2fa-ok. Кука доказывает, что вход под владельцем
// прошёл второй фактор. Значение = `${exp}.${sig}`, где sig = HMAC-SHA256 от
// `${userId}|${exp}`. Подделать нельзя, зная только пароль: секрет на клиент не
// уходит. Привязка к userId не даёт переиспользовать куку под другой аккаунт.
//
// Реализация на Web Crypto (crypto.subtle) — работает и в edge-middleware, и в
// Node-роуте, поэтому подпись/проверка гарантированно совпадают. Zero-deps —
// middleware может импортировать без затягивания supabase/telegram в edge-бандл.

const COOKIE = 'owner-2fa-ok'
export const OWNER_2FA_COOKIE = COOKIE

// Секрет для HMAC: отдельный OWNER_2FA_SECRET, иначе service-role ключ (он есть
// в обоих рантаймах и на клиент не попадает). Оба места резолвят одинаково.
export function owner2faSecret(): string {
  return process.env.OWNER_2FA_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

// Включён ли второй фактор для владельца. Пока флаг не выставлен — фича спит,
// поведение входа не меняется (ноль риска локаута).
export function isOwner2faEnabled(): boolean {
  return process.env.OWNER_2FA_ENABLED === 'true'
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return b64url(new Uint8Array(sig))
}

// Сравнение строк за постоянное время (не сливаем подпись по таймингам).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function mintOwner2faCookie(userId: string, secret: string, ttlMs: number): Promise<string> {
  const exp = Date.now() + ttlMs
  const sig = await hmac(secret, `${userId}|${exp}`)
  return `${exp}.${sig}`
}

export async function verifyOwner2faCookie(value: string | undefined, userId: string, secret: string): Promise<boolean> {
  if (!value || !secret) return false
  const dot = value.indexOf('.')
  if (dot < 0) return false
  const exp = Number(value.slice(0, dot))
  const sig = value.slice(dot + 1)
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  const expected = await hmac(secret, `${userId}|${exp}`)
  return safeEqual(sig, expected)
}
