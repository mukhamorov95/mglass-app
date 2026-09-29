// Маршрут без идентификаторов: /b2b-deal/5564 → /b2b-deal/[id]. Нужен, чтобы
// счётчик экранов (user_page_days) сводил одну страницу в одну строку.
// Цифры встречаются и в обычных сегментах («b2b»), поэтому [id] — только сегмент
// целиком из цифр и дефисов (05268, 0908-4), uuid или длинный токен.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMERIC = /^\d[\d-]*$/
const TOKEN = /^[A-Za-z0-9_-]{20,}$/

export function routeKey(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean).map(s => {
    let seg = s
    try { seg = decodeURIComponent(s) } catch { /* битая кодировка — оставляем как есть */ }
    if (UUID.test(seg) || NUMERIC.test(seg) || TOKEN.test(seg)) return '[id]'
    return /^[A-Za-z0-9_-]+$/.test(seg) ? seg : '[id]'
  })
  const key = '/' + segs.join('/')
  return key.length > 120 ? key.slice(0, 120) : key
}

// Какие запросы считать переходом человека: страницы (не API), не фоновая
// подгрузка ссылок роутером — иначе каждый пункт меню в поле зрения давал бы «визит».
export function isTrackablePageRequest(pathname: string, method: string, headers: Headers): boolean {
  if (method !== 'GET') return false
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/')) return false
  if (headers.get('next-router-prefetch')) return false
  const purpose = (headers.get('sec-purpose') ?? headers.get('purpose') ?? '').toLowerCase()
  if (purpose.includes('prefetch')) return false
  return true
}
