// Привязка Telegram и режим бота по роли (docs/SHOP_BOARD_ROUTE.md, этап 2).
// Без базы: что считать кодом, кому полный бот, когда хватит угадывать коды.

export const BOT_USERNAME = 'mglass_assistant_bot'

// Ссылка из приложения: Telegram откроет бота и сам пришлёт «/start <код>».
export const linkUrl = (code: string) => `https://t.me/${BOT_USERNAME}?start=${code}`

// Код в сообщении: «/start 123456» (пришёл по ссылке) — всегда; голые шесть цифр —
// только от непривязанного: у владельца шесть цифр — это сумма или кусок телефона в
// режиме расчёта, а не просьба перепривязать бота.
export function parseLinkCode(text: string | null | undefined, linked: boolean): string | null {
  const t = (text ?? '').trim()
  const start = t.match(/^\/start(?:@\w+)?\s+(\d{6})$/i)
  if (start) return start[1]
  return !linked && /^\d{6}$/.test(t) ? t : null
}

// Полный бот — меню, лиды с телефонами, «Написать клиенту», агенты — только владельцу.
// Остальным бот присылает уведомления и больше ничего не умеет.
export function botMode(role: string | null | undefined): 'full' | 'notify' {
  return role === 'admin' || role === 'ceo' ? 'full' : 'notify'
}

// Код — шесть цифр. Подбирать их из чужого Telegram дёшево, поэтому после пяти неверных
// за час бот перестаёт принимать коды с этого аккаунта до конца часа.
export const LINK_MAX_FAILS = 5
const LINK_WINDOW_MS = 60 * 60_000

export type LinkAttempts = { fails: number; since: string }

export function linkLocked(a: LinkAttempts | null | undefined, now: number): boolean {
  if (!a) return false
  return a.fails >= LINK_MAX_FAILS && now - Date.parse(a.since) < LINK_WINDOW_MS
}

export function afterFailedLink(a: LinkAttempts | null | undefined, now: number): LinkAttempts {
  if (!a || now - Date.parse(a.since) >= LINK_WINDOW_MS) return { fails: 1, since: new Date(now).toISOString() }
  return { fails: a.fails + 1, since: a.since }
}

export const NOTIFY_ONLY_TEXT = [
  '🔔 Сюда приходят уведомления табло цеха: новые поручения, «взял», «готово», комментарии.',
  'Отвечать и ставить поручения — в приложении.',
].join('\n')
