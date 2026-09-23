// Утреннее напоминание в Telegram: не вместо «Моего дня», а чтобы человек его открыл.
// Текст уходит с parse_mode HTML, поэтому имена сделок экранируются: один «<» в названии
// изделия — и Bot API отвергает сообщение целиком.

import { escapeHtml } from '@/lib/security/accessAudit'
import type { Coaching, FocusKind } from '@/lib/coaching/rules'

const WORD: Record<FocusKind, [string, string, string]> = {
  missed_call: ['перезвонить', 'перезвонить', 'перезвонить'],
  waiting_chat: ['ответить в чате', 'ответить в чате', 'ответить в чате'],
  new_lead: ['новая заявка', 'новые заявки', 'новых заявок'],
  hot_deal: ['горячая сделка', 'горячие сделки', 'горячих сделок'],
  overdue_tasks: ['хвост задач', 'хвост задач', 'хвост задач'],
}
const plural = (n: number, w: [string, string, string]) =>
  w[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2]

export function telegramDigest(c: Coaching, appUrl: string): string | null {
  if (c.focus.length === 0 && !c.habit) return null
  const byKind = new Map<FocusKind, number>()
  for (const f of c.focus) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1)
  const counts = [...byKind].map(([k, n]) => `${n} ${plural(n, WORD[k])}`).join(', ')

  const lines = [`<b>Мой день</b>, ${escapeHtml(c.name)}`]
  if (c.focus.length > 0) {
    lines.push(`Сегодня ${c.focus.length + c.focusMore} поводов: ${counts}${c.focusMore ? ' и другие' : ''}.`, '')
    for (const f of c.focus.slice(0, 3)) lines.push(`• ${escapeHtml(f.title)}`)
    if (c.focus.length > 3) lines.push(`• …ещё ${c.focus.length - 3} в списке`)
  }
  if (c.habit) lines.push('', `<b>Привычка недели:</b> ${escapeHtml(c.habit.title)} — ${escapeHtml(c.habit.action)}`)
  lines.push('', `Открыть список: ${appUrl}`)
  return lines.join('\n')
}
