import 'server-only'
import { amoGetAll } from '@/lib/amocrm'
import { onlinePbxHistory, isOnlinePbxConfigured } from '@/lib/onlinepbx'
import { normalizePbxCall } from '@/lib/pbxCalls'
import type { AmoActivityEvent } from '@/lib/amoActivity'
import type { Evidence } from '@/lib/coaching/effectRules'

// Сбор доказательств для замера эффекта: что произошло после утреннего снимка.
// Правила «закрыт ли повод» — в lib/coaching/effectRules.ts (чистые, под тестами).
export { isDone, scoreCoaching, type Evidence } from '@/lib/coaching/effectRules'

type Task = { responsible_user_id: number; complete_till: number }

export async function collectEvidence(since: number, now = Math.floor(Date.now() / 1000)): Promise<Evidence> {
  const events = await amoGetAll<AmoActivityEvent>('/events', {
    'filter[type][]': ['outgoing_chat_message', 'outgoing_call'],
    'filter[created_at][from]': String(since),
  }, 'events')
  const touchedLeads = new Set<number>()
  for (const e of events) if (e.entity_type === 'lead') touchedLeads.add(e.entity_id)

  const calledPhones = new Set<string>()
  if (isOnlinePbxConfigured()) {
    const raw = await onlinePbxHistory(since, now).catch(() => [])
    for (const r of raw) {
      const c = normalizePbxCall(r)
      if (!c || c.clientPhone.length !== 10) continue
      if (c.direction === 'out' || (c.direction === 'in' && c.answered)) calledPhones.add(c.clientPhone)
    }
  }

  const tasks = await amoGetAll<Task>('/tasks', { 'filter[is_completed]': '0' }, 'tasks')
  const overdueNow = new Map<number, number>()
  for (const t of tasks) {
    if (t.complete_till >= now) continue
    overdueNow.set(t.responsible_user_id, (overdueNow.get(t.responsible_user_id) ?? 0) + 1)
  }
  return { touchedLeads, calledPhones, overdueNow }
}
