import { createServiceClient } from '@/lib/supabase-service'
import { sendMessage, type InlineKeyboard } from '@/lib/telegram'
import { appUrl } from '@/lib/appUrl'

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

// Адресат — автор заказа, только если он сотрудник. У заказа из кабинета партнёра автор —
// сам партнёр, а партнёрам и клиентам ничего не отправляем без отдельного «да» владельца.
export function managerRecipient(
  order: { created_by?: string | null; source?: string | null } | null,
  authorRole: string | null | undefined,
): string | null {
  if (!order?.created_by || order.source === 'partner') return null
  if (!authorRole || authorRole === 'partner') return null
  return order.created_by
}

// Автор просчёта/заказа — ему и адресуем. Владелец получает свои уведомления кроном.
export async function notifyOrderManager(orderId: number, text: string, link?: string): Promise<boolean> {
  try {
    const svc = createServiceClient()
    const { data } = await svc.from('b2b_orders').select('created_by, source').eq('id', orderId).maybeSingle()
    const order = data as { created_by?: string | null; source?: string | null } | null
    if (!order?.created_by) return false
    const { data: author } = await svc.from('users').select('role').eq('id', order.created_by).maybeSingle()
    const userId = managerRecipient(order, (author as { role?: string | null } | null)?.role)
    if (!userId) return false
    const base = appUrl()
    const keyboard: InlineKeyboard | undefined = link && base
      ? [[{ text: 'Открыть', url: `${base}${link}` }]]
      : undefined
    return await notifyUser(userId, text, keyboard)
  } catch { return false }
}
