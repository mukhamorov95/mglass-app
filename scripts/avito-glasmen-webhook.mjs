// Подключает чаты кабинета GLASMEN к «Входящим заявкам B2B».
// Ключи — в .env.local: AVITO_GLASMEN_CLIENT_ID / _SECRET / _WEBHOOK_SECRET (их же — в Vercel).
//
//   node scripts/avito-glasmen-webhook.mjs            — проверить ключи и показать id аккаунта
//   node scripts/avito-glasmen-webhook.mjs subscribe  — подписать вебхук на прод
//   node scripts/avito-glasmen-webhook.mjs subscribe https://другой-адрес
//
// Адрес по умолчанию — app.mglass.pro: vercel.app из РФ режется, а вебхук шлют серверы Авито.
import { loadEnvLocal } from './lib/envLocal.mjs'

const env = loadEnvLocal()
const need = ['AVITO_GLASMEN_CLIENT_ID', 'AVITO_GLASMEN_CLIENT_SECRET']
const missing = need.filter(k => !env[k])
if (missing.length) { console.error(`Нет в .env.local: ${missing.join(', ')}`); process.exit(1) }

const tokenRes = await fetch('https://api.avito.ru/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.AVITO_GLASMEN_CLIENT_ID,
    client_secret: env.AVITO_GLASMEN_CLIENT_SECRET,
  }),
})
if (!tokenRes.ok) { console.error('Токен не выдан:', tokenRes.status, await tokenRes.text()); process.exit(1) }
const { access_token: token } = await tokenRes.json()
const auth = { Authorization: `Bearer ${token}` }

const selfRes = await fetch('https://api.avito.ru/core/v1/accounts/self', { headers: auth })
if (!selfRes.ok) { console.error('Аккаунт не прочитан:', selfRes.status, await selfRes.text()); process.exit(1) }
const self = await selfRes.json()
console.log(`Аккаунт: ${self.name ?? '—'} · id ${self.id}`)
if (String(self.id) !== String(env.AVITO_GLASMEN_USER_ID ?? '')) {
  console.log(`→ впишите AVITO_GLASMEN_USER_ID=${self.id} в .env.local и в Vercel`)
}
if (!/glasmen/i.test(self.name ?? '')) console.log('⚠ в названии нет GLASMEN — это точно ключи производства, а не розницы?')

const chatsRes = await fetch(`https://api.avito.ru/messenger/v2/accounts/${self.id}/chats?limit=1`, { headers: auth })
console.log(chatsRes.ok ? 'Мессенджер API: доступен' : `Мессенджер API: ${chatsRes.status} — нужен тариф с доступом к API мессенджера`)

if (process.argv[2] === 'subscribe') {
  if (!env.AVITO_GLASMEN_WEBHOOK_SECRET) { console.error('Нет AVITO_GLASMEN_WEBHOOK_SECRET'); process.exit(1) }
  const base = (process.argv[3] ?? 'https://app.mglass.pro').replace(/\/$/, '')
  const url = `${base}/api/avito/webhook/glasmen?key=${encodeURIComponent(env.AVITO_GLASMEN_WEBHOOK_SECRET)}`
  const r = await fetch('https://api.avito.ru/messenger/v3/webhook', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  })
  console.log(r.ok ? `Вебхук подписан: ${base}/api/avito/webhook/glasmen` : `Подписка не прошла: ${r.status} ${await r.text()}`)
}
