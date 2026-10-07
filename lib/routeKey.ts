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

// Счётчик ведёт браузер (с 08.10): переход внутри приложения, обслуженный из кэша
// роутера, до сервера не доходит, и middleware его не видел — после #814 счётчик
// занизил переходы в десятки раз. Тот же путь подряд — повторный рендер, а не переход.
export function createPageViewDeduper() {
  let last: string | null = null
  return (pathname: string | null | undefined): string | null => {
    if (!pathname || pathname === last) return null
    last = pathname
    if (pathname.startsWith('/api/') || pathname.startsWith('/_next/')) return null
    return routeKey(pathname)
  }
}

// Экраны, на которые человека приводит не ссылка, а запрет: высокая строка здесь
// означает «сюда выбрасывает», а не «этим пользуются». 01.10 /device-limit оказался
// в тройке самых частых экранов двух менеджеров — это была стена, а не раздел.
export const WALL_ROUTES = ['/device-limit', '/access-denied', '/login'] as const

export function isWallRoute(route: string): boolean {
  return (WALL_ROUTES as readonly string[]).includes(route)
}
