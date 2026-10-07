import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMessage, type InlineKeyboard } from '@/lib/telegram'

// Личное сообщение бухгалтерам (роль accountant) — тем, у кого привязан Telegram
// (telegram_users). Внутреннее, сотрудникам; партнёрам и клиентам отсюда ничего не уходит.
// Не доставлено — в лог и в итог вызова, а не молча.

export async function notifyAccountants(svc: SupabaseClient, text: string, keyboard?: InlineKeyboard): Promise<{
  accountants: number; linked: number; sent: number
}> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { accountants: 0, linked: 0, sent: 0 }
  const { data: users, error } = await svc.from('users').select('id, active').eq('role', 'accountant')
  if (error) throw new Error(`бухгалтеры не прочитаны: ${error.message}`)
  const ids = (users ?? []).filter(u => (u as { active?: boolean | null }).active !== false).map(u => String((u as { id: string }).id))
  if (!ids.length) return { accountants: 0, linked: 0, sent: 0 }

  const { data: tg, error: tgErr } = await svc.from('telegram_users').select('telegram_id, user_id').in('user_id', ids)
  if (tgErr) throw new Error(`привязки Telegram не прочитаны: ${tgErr.message}`)
  let sent = 0
  for (const row of tg ?? []) {
    const r = await sendMessage(Number(row.telegram_id), text, keyboard)
      .catch((e: unknown) => ({ ok: false, description: String(e) })) as { ok?: boolean; description?: string }
    if (r?.ok) sent++
    else console.error('[accounting-digest] бухгалтеру не доставлено', row.user_id, r?.description)
  }
  return { accountants: ids.length, linked: (tg ?? []).length, sent }
}
