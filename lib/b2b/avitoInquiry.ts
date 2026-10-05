import { sourceLabel } from '@/lib/types'
import { inquiryTitle, type Inquiry } from '@/lib/b2b/inquiries'

// Чат GLASMEN на Авито → входящая заявка B2B. Чистая логика без сети и базы:
// что за событие пришло вебхуком и какой текст уйдёт в Telegram.

export type AvitoWebhookBody = {
  payload?: {
    type?: string
    value?: {
      id?: string
      chat_id?: string
      user_id?: number
      author_id?: number
      item_id?: number
      chat_type?: string
      created?: number
      content?: { text?: string }
      type?: string
    }
  }
}

export type AvitoEvent =
  | { kind: 'skip'; reason: string }
  | { kind: 'in' | 'out'; msgId: string; chatId: string; itemId: number | null; text: string; at: string }

// Входящее — написал клиент, исходящее — ответили мы (из приложения Авито или с сайта).
// Чат с другим аккаунтом отбрасываем: вебхук подписан на один кабинет, чужой user_id — подлог.
export function parseAvitoEvent(body: AvitoWebhookBody | null, ownUserId: number): AvitoEvent {
  const v = body?.payload?.value
  if (body?.payload?.type !== 'message' || !v) return { kind: 'skip', reason: 'не сообщение' }
  if (!v.chat_id || typeof v.chat_id !== 'string') return { kind: 'skip', reason: 'нет чата' }
  if (v.user_id !== ownUserId) return { kind: 'skip', reason: 'чужой аккаунт' }
  if (v.chat_type && v.chat_type !== 'u2i') return { kind: 'skip', reason: 'не чат по объявлению' }
  if (v.author_id == null || v.author_id === 0) return { kind: 'skip', reason: 'системное сообщение' }
  const text = (v.content?.text ?? '').trim().slice(0, 2000)
  const msgId = v.id || `${v.chat_id}|${v.created ?? ''}|${text.slice(0, 80)}`
  const at = typeof v.created === 'number' ? new Date(v.created * 1000).toISOString() : new Date().toISOString()
  return {
    kind: v.author_id === ownUserId ? 'out' : 'in',
    msgId, chatId: v.chat_id, itemId: typeof v.item_id === 'number' ? v.item_id : null, text, at,
  }
}

export const avitoChatUrl = (chatId: string) =>
  `https://www.avito.ru/profile/messenger/channel/${encodeURIComponent(chatId)}`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Сообщение в Telegram (parse_mode HTML): всё, что пришло от клиента, экранировано —
// один «<» в тексте, и Bot API отвергнет сообщение целиком.
export function inquiryNotifyText(inq: Pick<Inquiry, 'id' | 'source' | 'contact_name' | 'company' | 'phone' | 'chat_url' | 'listing' | 'request'>, kind: 'new' | 'again'): string {
  const head = kind === 'new' ? '📥 <b>Новая заявка B2B</b>' : '🔁 <b>Клиент написал снова</b>'
  const lines = [
    `${head} · ${esc(sourceLabel(inq.source))}`,
    `<b>${esc(inquiryTitle(inq))}</b>${inq.phone ? ` · ${esc(inq.phone)}` : ''}`,
  ]
  if (inq.listing) lines.push(`Объявление: ${esc(inq.listing)}`)
  if (inq.request) lines.push(`«${esc(inq.request.slice(0, 300))}»`)
  lines.push('Ответить в течение 30 минут — от этого зависит уровень сервиса.')
  return lines.join('\n')
}
