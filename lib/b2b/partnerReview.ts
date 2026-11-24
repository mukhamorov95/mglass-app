// Проверка заявки из кабинета (владелец 24.11): партнёр отправил просчёт в работу → ответственному
// менеджеру уведомление «проверить»; когда менеджер согласовал, запустил или отклонил — пишем кто и когда.
// Хранится в notes.review, чтобы было видно: пришло в такое-то время, проверено во столько-то.

export type Review = {
  requested_at: string
  manager_id: string | null
  manager_name: string | null
  telegram: boolean                  // ушло ли сообщение в Telegram (нет привязки бота — false)
  checked_at?: string | null
  checked_by?: string | null
  outcome?: 'approved' | 'rejected' | null
}

type Notes = Record<string, unknown>

export function reviewOf(notes: Notes | null | undefined): Review | null {
  const r = notes?.review as Review | undefined
  return r && typeof r === 'object' && typeof r.requested_at === 'string' ? r : null
}

const APPROVING = new Set(['agreed', 'confirmed', 'in_production', 'completed'])

// Действие менеджера над заказом → отметка проверки, если заявка ждёт её. Иначе пусто.
export function checkPatch(fresh: Notes, action: { kind: 'launch' } | { kind: 'status'; to: string }, at: string, who: string | null): Notes {
  const r = reviewOf(fresh)
  if (!r || r.checked_at) return {}
  const outcome = action.kind === 'launch' || APPROVING.has(action.to) ? 'approved'
    : action.kind === 'status' && (action.to === 'rejected' || action.to === 'cancelled') ? 'rejected' : null
  if (!outcome) return {}
  return { review: { ...r, checked_at: at, checked_by: who, outcome } }
}

// Ответственный: назначенный у клиента, иначе тот из сотрудников, кто чаще всех считал этому клиенту.
export function pickManager(assigned: string | null | undefined, authors: (string | null | undefined)[]): string | null {
  if (assigned) return assigned
  const n = new Map<string, number>()
  for (const a of authors) if (a) n.set(a, (n.get(a) ?? 0) + 1)
  let best: string | null = null, max = 0
  for (const [k, v] of n) if (v > max) { best = k; max = v }
  return best
}

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })

export function reviewLine(r: Review): string {
  const sent = `пришло на проверку ${fmt(r.requested_at)}${r.manager_name ? ` · ${r.manager_name}` : ''}${r.telegram ? ' (Telegram)' : ''}`
  if (!r.checked_at) return `${sent} · ещё не проверено`
  return `${sent} · ${r.outcome === 'rejected' ? 'проверено и отклонено' : 'проверено и одобрено'} ${fmt(r.checked_at)}${r.checked_by ? ` · ${r.checked_by}` : ''}`
}
