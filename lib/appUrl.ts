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
// Российский вход работает с 29.09 (docs/RUSSIA_ACCESS_ROUTE.md). Старый адрес у части
// провайдеров не открывается, так что ссылка для человека на vercel.app — ссылка, которая
// может не открыться (30.09: Вере выдали ссылку смены пароля на старый адрес). Пока в
// NEXT_PUBLIC_APP_URL стоит старый адрес или пусто — отдаём российский; свой адрес в
// настройке (превью, другой домен) главнее.
export const PUBLIC_APP = 'https://app.mglass.pro'

const trim = (u: string) => u.replace(/\/+$/, '')

export function appUrl(path = ''): string {
  const env = trim(process.env.NEXT_PUBLIC_APP_URL ?? '')
  return (env && env !== VERCEL_PROD ? env : PUBLIC_APP) + path
}

export function internalAppUrl(): string | null {
  const url = process.env.INTERNAL_APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
    || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '')
  return url ? trim(url) : null
}
