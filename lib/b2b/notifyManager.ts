import { createServiceClient } from '@/lib/supabase-service'
import { sendMessage, type InlineKeyboard } from '@/lib/telegram'

// А14: уведомления менеджеру в Telegram о событиях его заказов. До этого крон писал
// владельцу и партнёру, а менеджер узнавал об оплате и вопросах клиента случайно.
//
// Всё здесь — best effort: нет токена бота, нет привязки telegram_users или упал
// сетевой вызов → тихо ничего не делаем. Уведомление никогда не должно ронять
// бизнес-операцию, ради которой его отправляют.

async function chatIdOf(userId: string | null | undefined): Promise<number | null> {
  if (!userId) return null
  try {
    const svc = createServiceClient()
    const { data } = await svc.from('telegram_users').select('telegram_id').eq('user_id', userId).maybeSingle()
    const id = (data as { telegram_id?: number } | null)?.telegram_id
    return typeof id === 'number' ? id : null
  } catch { return null }
}

export async function notifyUser(userId: string | null | undefined, text: string, keyboard?: InlineKeyboard): Promise<boolean> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false
  const chatId = await chatIdOf(userId)
  if (!chatId) return false
  try {
    await sendMessage(chatId, text, keyboard)
    return true
  } catch { return false }
}

// Автор просчёта/заказа — ему и адресуем. Владелец получает свои уведомления кроном.
export async function notifyOrderManager(orderId: number, text: string, link?: string): Promise<boolean> {
  try {
    const svc = createServiceClient()
    const { data } = await svc.from('b2b_orders').select('created_by').eq('id', orderId).maybeSingle()
    const userId = (data as { created_by?: string | null } | null)?.created_by ?? null
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    const keyboard: InlineKeyboard | undefined = link && base
      ? [[{ text: 'Открыть', url: `${base}${link}` }]]
      : undefined
    return await notifyUser(userId, text, keyboard)
  } catch { return false }
}
