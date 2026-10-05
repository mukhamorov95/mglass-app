import { createServiceClient } from '@/lib/supabase-service'
import { sendMessage, type InlineKeyboard } from '@/lib/telegram'
import { appUrl } from '@/lib/appUrl'

// Уведомление о заявке тем, кого владелец включил в b2b_inquiry_notify. Best effort:
// упавший Telegram не должен ронять запись заявки, но и молча не теряется — в лог.
export async function notifyInquiryRecipients(text: string, exceptUserId?: string | null): Promise<number> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return 0
  const svc = createServiceClient()
  const { data: rows, error } = await svc.from('b2b_inquiry_notify').select('user_id')
  if (error) { console.error('[inquiry-notify] получатели не прочитаны', error.message); return 0 }
  const ids = (rows ?? []).map(r => r.user_id as string).filter(id => id !== exceptUserId)
  if (!ids.length) return 0
  const { data: tg, error: tgErr } = await svc.from('telegram_users').select('telegram_id, user_id').in('user_id', ids)
  if (tgErr) { console.error('[inquiry-notify] telegram_users не прочитаны', tgErr.message); return 0 }
  const keyboard: InlineKeyboard = [[{ text: 'Открыть заявки', url: appUrl('/b2b-crm/inquiries') }]]
  let sent = 0
  for (const row of tg ?? []) {
    const r = await sendMessage(row.telegram_id as number, text, keyboard)
      .catch((e: unknown) => ({ ok: false, description: String(e) })) as { ok?: boolean; description?: string }
    if (r?.ok) sent++
    else console.error('[inquiry-notify] не доставлено', row.user_id, r?.description)
  }
  return sent
}

// Кому назначить заявку из чата: владелец видит всё и так; если в получателях ровно один
// сотрудник не из владельцев — заявка его, иначе без назначения (раздаст владелец).
export async function inquiryAssignee(): Promise<string | null> {
  const svc = createServiceClient()
  const { data, error } = await svc.from('b2b_inquiry_notify').select('user_id, users!b2b_inquiry_notify_user_id_fkey(role, active)')
  if (error) { console.error('[inquiry-notify] назначение не прочитано', error.message); return null }
  const staff = (data ?? []).filter(r => {
    const u = (r as { users?: unknown }).users as unknown as { role?: string; active?: boolean | null }
    return u?.role !== 'admin' && u?.role !== 'ceo' && u?.active !== false
  })
  return staff.length === 1 ? (staff[0].user_id as string) : null
}
