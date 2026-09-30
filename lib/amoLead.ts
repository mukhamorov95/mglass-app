// Сделка AmoCRM как источник клиента для расчёта и КП (решение владельца 30.09:
// розница остаётся в AmoCRM, приложение считает и делает КП в один клик из сделки).
// Здесь только чистые правила — модуль берут и браузер, и сервер. Запросы к CRM —
// в lib/amoViewer.ts.

// «https://mglass.amocrm.ru/leads/detail/12345» и «12345» — оба валидны.
export function leadIdFrom(input: unknown): number | null {
  const s = String(input ?? '').trim()
  if (!s) return null
  const direct = Number(s)
  if (Number.isFinite(direct) && Number.isInteger(direct) && direct > 0) return direct
  const m = s.match(/(?:detail\/|leads\/)(\d+)/) ?? s.match(/(\d{4,})/)
  return m ? Number(m[1]) : null
}

export type AmoContactRaw = {
  id: number; name: string
  custom_fields_values?: { field_code?: string; values?: { value?: string }[] }[] | null
}

export function amoFieldValue(c: AmoContactRaw | null, code: string): string {
  const f = c?.custom_fields_values?.find(x => x.field_code === code)
  return String(f?.values?.[0]?.value ?? '').trim()
}

// Своя сделка — у ответственного в AmoCRM тот же amo_user_id. Владелец и «видит все
// сделки» (users.can_view_all_deals) — любые. Правило 4: чужое без разрешения не видно.
export function canSeeLead(
  viewer: { isOwner: boolean; canViewAll: boolean; amoUserId: number | null },
  responsibleUserId: number,
): boolean {
  if (viewer.isOwner || viewer.canViewAll) return true
  return viewer.amoUserId != null && viewer.amoUserId === responsibleUserId
}

// Закрытые этапы AmoCRM одинаковы во всех воронках: 142 — успешно, 143 — не реализовано.
export const AMO_CLOSED_STATUSES = new Set([142, 143])

export type AmoLeadCard = {
  id: number
  name: string
  price: number | null
  stageName: string | null
  responsibleUserId: number
  closed: boolean
  contactName: string
  phone: string
  url: string
}
