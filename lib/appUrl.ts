// Адрес приложения — в одном месте (маршрут docs/RUSSIA_ACCESS_ROUTE.md, Э2в).
//
// appUrl — для людей: ссылки в Telegram, письмах, приглашениях. После запуска
// российского входа NEXT_PUBLIC_APP_URL станет его адресом.
//
// internalAppUrl — для самовызовов сервера с CRON_SECRET (очередь, агенты). Их незачем
// гонять через Россию и обратно, поэтому при переезде INTERNAL_APP_URL оставляют на
// прямом адресе Vercel. Берётся только из настроек, не из заголовка Host: поддельный
// Host увёл бы запрос вместе с секретом на чужой сервер.
const VERCEL_PROD = 'https://mglass-app.vercel.app'

const trim = (u: string) => u.replace(/\/+$/, '')

export function appUrl(path = ''): string {
  return trim(process.env.NEXT_PUBLIC_APP_URL || VERCEL_PROD) + path
}

export function internalAppUrl(): string | null {
  const url = process.env.INTERNAL_APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
    || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '')
  return url ? trim(url) : null
}
