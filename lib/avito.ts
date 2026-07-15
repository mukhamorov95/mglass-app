// Avito Messenger API: токен по client_credentials, отправка сообщений в чат.
// Ключи AVITO_CLIENT_ID / AVITO_CLIENT_SECRET из кабинета developers.avito.ru.
// Без ключей модуль деградирует мягко: isAvitoConfigured() = false, бот работает
// в песочнице (/crm/bot-test), вебхук пишет диалог в CRM без исходящих.

let cachedToken: { token: string; expiresAt: number } | null = null

export function isAvitoConfigured(): boolean {
  return !!(process.env.AVITO_CLIENT_ID && process.env.AVITO_CLIENT_SECRET)
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.AVITO_CLIENT_ID!,
    client_secret: process.env.AVITO_CLIENT_SECRET!,
  })
  const res = await fetch('https://api.avito.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`avito token ${res.status}: ${await res.text()}`)
  const j = await res.json() as { access_token: string; expires_in: number }
  cachedToken = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 }
  return j.access_token
}

export async function avitoSendMessage(userId: number | string, chatId: string, text: string): Promise<void> {
  const token = await getToken()
  const res = await fetch(`https://api.avito.ru/messenger/v1/accounts/${userId}/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: { text }, type: 'text' }),
  })
  if (!res.ok) throw new Error(`avito send ${res.status}: ${await res.text()}`)
}

// ── Чтение диалогов (для импорта существующих заявок в CRM) ──────────────────
// Требует скоуп messenger:read. Если у client_credentials его нет — вернётся 403,
// и вызывающий код покажет понятное сообщение (мягкая деградация).

async function avitoGet<T>(path: string): Promise<T> {
  const token = await getToken()
  const res = await fetch(`https://api.avito.ru${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`avito GET ${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export type AvitoChat = {
  id: string
  users?: { id: number; name?: string }[]
  context?: { value?: { title?: string; url?: string } }
  last_message?: { content?: { text?: string }; created?: number; author_id?: number }
  created?: number
  updated?: number
}
export type AvitoMsg = {
  id: string
  author_id?: number
  created?: number
  direction?: 'in' | 'out'
  type?: string
  content?: { text?: string }
}

// id аккаунта Авито (нужен как {user_id} для путей мессенджера).
export async function avitoGetSelfId(): Promise<number> {
  const j = await avitoGet<{ id: number }>('/core/v1/accounts/self')
  return j.id
}

export async function avitoListChats(userId: number | string, opts: { limit?: number; offset?: number } = {}): Promise<AvitoChat[]> {
  const limit = opts.limit ?? 100
  const offset = opts.offset ?? 0
  const j = await avitoGet<{ chats?: AvitoChat[] }>(
    `/messenger/v2/accounts/${userId}/chats?limit=${limit}&offset=${offset}&chat_types=u2i`,
  )
  return j.chats ?? []
}

export async function avitoListMessages(userId: number | string, chatId: string, opts: { limit?: number } = {}): Promise<AvitoMsg[]> {
  const limit = opts.limit ?? 100
  const j = await avitoGet<{ messages?: AvitoMsg[] }>(
    `/messenger/v3/accounts/${userId}/chats/${chatId}/messages/?limit=${limit}`,
  )
  return j.messages ?? []
}

// Подписка вебхука (вызывается один раз после появления ключей):
// node -e "import('./lib/avito.js').then(m => m.avitoSubscribeWebhook('https://mglass-app.vercel.app/api/avito/webhook?key=…'))"
export async function avitoSubscribeWebhook(url: string): Promise<void> {
  const token = await getToken()
  const res = await fetch('https://api.avito.ru/messenger/v3/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) throw new Error(`avito webhook subscribe ${res.status}: ${await res.text()}`)
}
