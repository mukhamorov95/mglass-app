// Закрыт ли повод из утреннего списка — чистые правила, без обращений к сети
// (сбор доказательств — в lib/coaching/effect.ts). Закрыт значит человек реально связался:
// написал или позвонил по этой карточке, перезвонил на номер, разгрёб задачи.

import type { Coaching, FocusItem } from '@/lib/coaching/rules'

export type Evidence = {
  touchedLeads: Set<number>                  // сделки, по которым после снимка было исходящее
  calledPhones: Set<string>                  // номера, на которые после снимка звонили (или приняли их звонок)
  overdueNow: Map<number, number>            // сколько просроченных задач у человека сейчас
}
export function isDone(item: FocusItem, userId: number, ev: Evidence): boolean {
  if (item.leadId !== null) return ev.touchedLeads.has(item.leadId)
  if (item.kind === 'missed_call') {
    const phone = item.url?.startsWith('tel:') ? item.url.replace(/\D/g, '').slice(-10) : null
    return phone ? ev.calledPhones.has(phone) : false
  }
  if (item.kind === 'overdue_tasks') {
    const was = Number(item.title.replace(/\D/g, '')) || 0
    const now = ev.overdueNow.get(userId)
    return now !== undefined && now < was
  }
  return false
}

export function scoreCoaching(c: Coaching, ev: Evidence) {
  const byKind: Record<string, { items: number; done: number }> = {}
  let done = 0
  for (const it of c.focus) {
    const ok = isDone(it, c.amoUserId, ev)
    byKind[it.kind] ??= { items: 0, done: 0 }
    byKind[it.kind].items++
    if (ok) { byKind[it.kind].done++; done++ }
  }
  return { items: c.focus.length, done, byKind }
}

