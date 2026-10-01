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
  // Переход человека — это либо загрузка страницы целиком (sec-fetch-dest: document),
  // либо переход внутри приложения (роутер присылает RSC). Всё остальное — фоновый
  // запрос к адресу страницы: сервис-воркер, свой fetch, предпросмотр ссылки. Раньше
  // такие запросы попадали в счётчик наравне с переходами, и хвост отчёта нельзя было
  // отличить от «человек прошёлся по меню» (У12).
  const dest = (headers.get('sec-fetch-dest') ?? '').toLowerCase()
  const routerNav = Boolean(headers.get('rsc') ?? headers.get('next-router-state-tree'))
  // Браузер без Sec-Fetch-* и без заголовков роутера — не наказываем: считаем переходом.
  if (dest && dest !== 'document' && !routerNav) return false
  return true
}

// Экраны, на которые человека приводит не ссылка, а запрет: высокая строка здесь
// означает «сюда выбрасывает», а не «этим пользуются». 01.10 /device-limit оказался
// в тройке самых частых экранов двух менеджеров — это была стена, а не раздел.
export const WALL_ROUTES = ['/device-limit', '/access-denied', '/login'] as const

export function isWallRoute(route: string): boolean {
  return (WALL_ROUTES as readonly string[]).includes(route)
}
