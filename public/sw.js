// Минимальный service worker для устанавливаемости PWA «Цех».
// Без офлайн-кэша (данные должны быть свежими), только passthrough сети.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => { /* passthrough — браузер обрабатывает запрос сам */ })
