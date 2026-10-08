import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/telegram'
import { appUrl } from '@/lib/appUrl'
import { managerRecipient } from '@/lib/b2b/notifyManager'
import { boardMessage, boardRecipients, STAFF_ROLES, type BoardCard, type BoardEvent } from './model'
import type { BoardActor } from './server'

// Уведомления табло в Telegram (docs/SHOP_BOARD_ROUTE.md, этап 2). Best effort: сбой
// отправки пишем в лог и не трогаем поручение — его уже сохранили.
// Адресаты — только действующие сотрудники; партнёр не попадает ни при каком раскладе.

const STAFF = new Set<string>(STAFF_ROLES)

type UserRow = { id: string; role: string | null; active: boolean | null; permissions: { shop_board?: boolean } | null }
type OrderRow = { id: number; custom_number: string | null; client_name: string | null; created_by: string | null; source: string | null }

export async function notifyBoard(
  svc: SupabaseClient,
  kind: BoardEvent['kind'],
  card: BoardCard,
  actor: BoardActor,
  comment?: string | null,
): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return
  try {
    const [{ data: users, error: uErr }, { data: orders, error: oErr }] = await Promise.all([
      svc.from('users').select('id, role, active, permissions'),
      card.order_ids?.length
        ? svc.from('b2b_orders').select('id, custom_number, client_name, created_by, source').in('id', card.order_ids)
        : Promise.resolve({ data: [] as OrderRow[], error: null }),
    ])
    if (uErr || oErr) { console.error(`[shop-board] notify ${kind} card=${card.id}: ${(uErr ?? oErr)!.message}`); return }

    const staff = ((users ?? []) as UserRow[]).filter(u => u.active !== false && STAFF.has(u.role ?? ''))
    const roleOf = new Map(staff.map(u => [u.id, u.role]))
    const os = (orders ?? []) as OrderRow[]
    const people = {
      shop: staff.filter(u => u.role === 'production').map(u => u.id),
      owners: staff.filter(u => u.role === 'admin' || u.role === 'ceo').map(u => u.id),
      boardUsers: staff.filter(u => u.permissions?.shop_board === true).map(u => u.id),
      orderManagers: os.map(o => managerRecipient(o, roleOf.get(o.created_by ?? '') ?? null)).filter((id): id is string => !!id),
    }
    // Взявший или поставивший мог уйти или оказаться не сотрудником — второй фильтр на выходе.
    const to = boardRecipients(kind, card, actor.id, people).filter(id => roleOf.has(id))
    if (!to.length) return

    const { data: links, error: lErr } = await svc.from('telegram_users').select('telegram_id, user_id, linked_at')
      .in('user_id', to).order('linked_at', { ascending: false })
    if (lErr) { console.error(`[shop-board] notify links: ${lErr.message}`); return }
    const chat = new Map<string, number>()
    for (const l of (links ?? []) as { telegram_id: number; user_id: string }[]) if (!chat.has(l.user_id)) chat.set(l.user_id, Number(l.telegram_id))
    if (!chat.size) return

    const text = boardMessage(kind, card, actor.name,
      os.map(o => ({ ref: o.custom_number?.trim() || `#${o.id}`, client: o.client_name })), Date.now(), comment)
    const keyboard = [[{ text: 'Открыть табло', url: appUrl('/production-app/control') }]]
    const sent = await Promise.allSettled([...chat.values()].map(id => sendMessage(id, text, keyboard)))
    const failed = sent.filter(s => s.status === 'rejected' || (s.value as { ok?: boolean } | null)?.ok === false).length
    if (failed) console.error(`[shop-board] notify ${kind} card=${card.id}: не дошло ${failed} из ${sent.length}`)
  } catch (e) {
    console.error(`[shop-board] notify ${kind} card=${card.id}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
