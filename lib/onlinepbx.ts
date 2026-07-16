// OnlinePBX (облачная АТС) — телефония M-Glass. Домен и ключ только из env,
// секрет в коде не хранится. Две задачи:
//   1) click-to-call из CRM (нужен API-ключ) — onlinePbxCall();
//   2) приём событий звонков и ссылок на записи — вебхук /api/onlinepbx/webhook,
//      ему API-ключ НЕ нужен (АТС сама шлёт события модулем «HTTP-запрос»).
// HTTP API OnlinePBX: авторизация по auth_key → выдаёт key_id + key, дальше
// запросы подписываются HMAC-SHA1 (заголовок x-pbx-authentication). База:
// https://api.onlinepbx.ru/{domain}/...

import { createHash, createHmac } from 'crypto'

const DOMAIN = process.env.ONLINEPBX_DOMAIN            // напр. pbx12210.onpbx.ru
const AUTH_KEY = process.env.ONLINEPBX_API_KEY         // auth_key (секрет)
const DEFAULT_EXT = process.env.ONLINEPBX_DEFAULT_EXT  // внутр. номер по умолчанию (Семён = 100)

const API_BASE = 'https://api.onlinepbx.ru'

export function isOnlinePbxConfigured(): boolean {
  return !!(DOMAIN && AUTH_KEY)
}

export function onlinePbxDefaultExt(): string | null {
  return DEFAULT_EXT ?? null
}

// Нормализация РФ-номера → 7XXXXXXXXXX (для набора). Для сопоставления с лидом
// сравниваем по последним 10 цифрам (digits10) — устойчиво к +7/8/скобкам.
export function normalizePhone(raw: string): string {
  let d = (raw || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1)
  else if (d.length === 10) d = '7' + d
  return d
}

export function digits10(raw: string): string {
  return (raw || '').replace(/\D/g, '').slice(-10)
}

type Session = { keyId: string; key: string }
let cached: { s: Session; exp: number } | null = null

async function auth(): Promise<Session> {
  if (cached && cached.exp > Date.now()) return cached.s
  const res = await fetch(`${API_BASE}/${DOMAIN}/auth.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ auth_key: AUTH_KEY! }),
  })
  const j = (await res.json().catch(() => null)) as
    { status?: string; data?: { key_id?: string; key?: string }; comment?: string } | null
  const keyId = j?.data?.key_id
  const key = j?.data?.key
  if (!keyId || !key) throw new Error('OnlinePBX auth не удалась: ' + (j?.comment || `HTTP ${res.status}`))
  const s = { keyId, key }
  cached = { s, exp: Date.now() + 10 * 60 * 1000 }   // ключ живёт ~сессию, кэшируем 10 мин
  return s
}

// Подпись запроса (как в оф. PHP-клиенте OnlinePBX, схема Amazon-REST):
// строка = METHOD\nContent-MD5\nContent-Type\nDate\nURL\n (с завершающим \n),
// HMAC-SHA1 в BASE64, заголовок x-pbx-authentication: key_id:signature.
function signHeader(s: Session, method: string, path: string, contentType: string, contentMd5: string, date: string): string {
  const stringToSign = `${method}\n${contentMd5}\n${contentType}\n${date}\n${path}\n`
  const signature = createHmac('sha1', s.key).update(stringToSign).digest('base64')
  return `${s.keyId}:${signature}`
}

async function apiPost(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const s = await auth()
  const body = new URLSearchParams(params).toString()
  const contentType = 'application/x-www-form-urlencoded'
  const contentMd5 = createHash('md5').update(body).digest('hex')
  const date = new Date().toUTCString().replace('GMT', '+0000')   // RFC-2822 как date('r')
  const fullPath = `/${DOMAIN}${path}`

  const doFetch = (authValue: string) => fetch(`${API_BASE}${fullPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Content-MD5': contentMd5,
      'Date': date,
      'x-pbx-authentication': authValue,
    },
    body,
  })

  // Первичная схема — подписанный запрос. Если АТС ответит ошибкой авторизации
  // (часть кабинетов принимает простую пару key_id:key) — один ретрай простым
  // заголовком. Финально сверяем на первом реальном звонке после выдачи ключа.
  let res = await doFetch(signHeader(s, 'POST', fullPath, contentType, contentMd5, date))
  let j = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (String(j?.status ?? '') !== '1' && /auth/i.test(String(j?.comment ?? ''))) {
    cached = null
    const s2 = await auth()
    res = await doFetch(`${s2.keyId}:${s2.key}`)
    j = (await res.json().catch(() => ({}))) as Record<string, unknown>
  }
  return j
}

// Click-to-call: АТС звонит внутреннему номеру (менеджеру), затем набирает
// клиента и соединяет. from — внутренний (ext), to — номер клиента.
export async function onlinePbxCall(phone: string, ext: string): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  if (!isOnlinePbxConfigured()) throw new Error('OnlinePBX не настроен (нет ONLINEPBX_DOMAIN / ONLINEPBX_API_KEY)')
  const to = normalizePhone(phone)
  const body = await apiPost('/call/now.json', { from: ext, to })
  return { ok: String(body?.status ?? '') === '1', body }
}
