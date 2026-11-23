import { hmac, owner2faSecret, safeEqual } from './owner2faCookie'

// Кэш роли/скоупа в куках middleware: `${userId}|${value}|${sig}`, sig — HMAC от имени куки,
// id и значения. Без подписи любой вошедший мог вписать себе в браузере `<свой id>|admin`
// и пройти ворота страниц. Неподписанная, чужая или старая кука — промах кэша: роль
// перечитывается из базы. Нет секрета — кэш не верим вовсе.

export const roleCookieSecret = owner2faSecret

export async function signScoped(name: string, userId: string, value: string, secret: string): Promise<string> {
  return `${userId}|${value}|${await hmac(secret, `${name}|${userId}|${value}`)}`
}

export async function readSignedScoped(name: string, cookieValue: string | undefined, userId: string, secret: string): Promise<string | undefined> {
  if (cookieValue === undefined || !secret) return undefined
  const first = cookieValue.indexOf('|')
  const last = cookieValue.lastIndexOf('|')
  if (first < 0 || last === first) return undefined
  if (cookieValue.slice(0, first) !== userId) return undefined
  const value = cookieValue.slice(first + 1, last)
  const sig = cookieValue.slice(last + 1)
  return safeEqual(sig, await hmac(secret, `${name}|${userId}|${value}`)) ? value : undefined
}
