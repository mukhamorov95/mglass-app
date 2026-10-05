// Кабинет GLASMEN (производство) на Авито — свои ключи, отдельно от розничного M GLASS
// (lib/avito.ts). Только чтение: имя собеседника и объявление чата. Отвечает в чате человек.

let cached: { token: string; expiresAt: number } | null = null

export function glasmenUserId(): number | null {
  const n = Number(process.env.AVITO_GLASMEN_USER_ID)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function isGlasmenApiConfigured(): boolean {
  return !!(process.env.AVITO_GLASMEN_CLIENT_ID && process.env.AVITO_GLASMEN_CLIENT_SECRET && glasmenUserId())
}

export async function glasmenToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token
  const res = await fetch('https://api.avito.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.AVITO_GLASMEN_CLIENT_ID!,
      client_secret: process.env.AVITO_GLASMEN_CLIENT_SECRET!,
    }),
  })
  if (!res.ok) throw new Error(`avito glasmen token ${res.status}: ${await res.text()}`)
  const j = await res.json() as { access_token: string; expires_in: number }
  cached = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 }
  return j.access_token
}

export type GlasmenChatInfo = { contactName: string | null; listing: string | null }

// Без ключей или при ошибке — пустые поля: заявка всё равно создаётся по ссылке на чат.
export async function glasmenChatInfo(chatId: string): Promise<GlasmenChatInfo> {
  const userId = glasmenUserId()
  if (!isGlasmenApiConfigured() || !userId) return { contactName: null, listing: null }
  try {
    const token = await glasmenToken()
    const res = await fetch(`https://api.avito.ru/messenger/v2/accounts/${userId}/chats/${encodeURIComponent(chatId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    const j = await res.json() as {
      users?: { id: number; name?: string }[]
      context?: { value?: { title?: string } }
    }
    const other = (j.users ?? []).find(u => u.id !== userId)
    return {
      contactName: other?.name?.trim().slice(0, 120) || null,
      listing: j.context?.value?.title?.trim().slice(0, 200) || null,
    }
  } catch (e) {
    console.error('[avito-glasmen] чат не прочитан', chatId, e instanceof Error ? e.message : e)
    return { contactName: null, listing: null }
  }
}
