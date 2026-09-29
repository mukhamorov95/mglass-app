// Service worker приложения: устанавливаемость PWA «Цех» и кабинета партнёра, без
// офлайн-кэша (данные должны быть свежими).
//
// Одна подмена. Картинки и файлы хранилища браузер берёт по ссылкам на *.supabase.co,
// сохранённым в базе, а этот адрес у части провайдеров режется (#173). Такие запросы
// отправляем на тот же путь под /supabase — его Vercel проксирует на Supabase
// (next.config.ts). Хост проекта приходит параметром регистрации (?sb=); всё остальное
// браузер обрабатывает сам.
const SB_HOST = new URL(self.location).searchParams.get('sb')

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  if (!SB_HOST || e.request.method !== 'GET') return
  let url
  try { url = new URL(e.request.url) } catch { return }
  if (url.host !== SB_HOST || !url.pathname.startsWith('/storage/v1/')) return
  // Заголовки сохраняем: Range нужен видео и аудио.
  e.respondWith(fetch('/supabase' + url.pathname + url.search, {
    headers: e.request.headers,
    credentials: 'same-origin',
  }))
})
