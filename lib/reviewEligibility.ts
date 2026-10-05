import { normalizePhone } from '@/lib/reviewMessage'

// Кому из сданных объектов писать. Без сети и базы — чтобы правило проверялось тестом.
//
// Первый контакт сделки — не обязательно клиент: на 05.10 из 98 сделок за 90 дней у 39
// первым стоял дизайнер, партнёр или прораб. Партнёрам не пишем вовсе, а их клиентам —
// тоже: заказ пришёл через партнёра, и выходить на его клиента в обход нельзя.

export type ReviewLead = {
  id: number; name: string; price: number; closed_at: number; updated_at: number
  custom_fields_values?: { field_name?: string; values?: { value?: unknown }[] }[] | null
  _embedded?: { contacts?: { id: number }[]; tags?: { name: string }[] }
}
export type ReviewContact = {
  id: number; name: string
  custom_fields_values?: { field_name?: string; field_code?: string; values?: { value?: unknown }[] }[] | null
}

export type SkipReason = 'partner' | 'no_customer' | 'duplicate' | 'asked_before' | 'complaint'

export const SKIP_LABEL: Record<SkipReason, string> = {
  partner: 'заказ через партнёра или дизайнера',
  no_customer: 'нет контакта «Заказчик» с телефоном',
  duplicate: 'второй заказ того же человека',
  asked_before: 'уже в очереди или уже писали',
  complaint: 'была рекламация',
}

export type ReviewRow = {
  amo_lead_id: number; client_name: string; phone: string
  order_title: string; amount: number; done_at: string
}

const PARTNER_TAG = /партн|дизайн|прораб/i

function field(list: ReviewLead['custom_fields_values'], name: string): string {
  const v = (list ?? []).find(f => f.field_name === name)?.values?.[0]?.value
  return v == null ? '' : String(v)
}

export function isPartnerDeal(l: ReviewLead): boolean {
  if (field(l.custom_fields_values, 'ИСТОЧНИК СДЕЛКИ') === 'Партнёр') return true
  if ((l._embedded?.tags ?? []).some(t => PARTNER_TAG.test(t.name))) return true
  // «Дизайнерские» — вознаграждение дизайнеру: раз платили, клиент его
  return Number(field(l.custom_fields_values, 'Дизайнерские') || 0) > 0
}

export function customerOf(l: ReviewLead, byId: Map<number, ReviewContact>): { name: string; phone: string } | null {
  for (const ref of l._embedded?.contacts ?? []) {
    const c = byId.get(ref.id)
    if (!c || field(c.custom_fields_values, 'Тип контакта') !== 'Заказчик') continue
    const raw = (c.custom_fields_values ?? []).find(f => f.field_code === 'PHONE')?.values?.[0]?.value
    const phone = normalizePhone(raw == null ? '' : String(raw))
    if (phone.length === 11) return { name: c.name, phone }
  }
  return null
}

export function selectRecipients(
  leads: ReviewLead[], contacts: ReviewContact[], askedBefore: Set<string>,
): { rows: ReviewRow[]; skipped: Partial<Record<SkipReason, number>> } {
  const byId = new Map(contacts.map(c => [c.id, c]))
  const skipped: Partial<Record<SkipReason, number>> = {}
  const skip = (r: SkipReason): ReviewRow[] => { skipped[r] = (skipped[r] ?? 0) + 1; return [] }
  const seen = new Set<string>()

  // Свежие первыми: из двух заказов одного человека просим про последний
  const rows = [...leads].sort((a, b) => b.closed_at - a.closed_at).flatMap((l): ReviewRow[] => {
    if (isPartnerDeal(l)) return skip('partner')
    const c = customerOf(l, byId)
    if (!c) return skip('no_customer')
    if (seen.has(c.phone)) return skip('duplicate')
    seen.add(c.phone)
    if (askedBefore.has(c.phone)) return skip('asked_before')
    // Человек с рекламацией — разговор менеджера, а не автоматическое сообщение
    if (field(l.custom_fields_values, 'Была рекламация?') === 'Да') return skip('complaint')
    return [{
      amo_lead_id: l.id, client_name: c.name, phone: c.phone,
      order_title: l.name, amount: l.price,
      done_at: new Date((l.closed_at || l.updated_at) * 1000).toISOString().slice(0, 10),
    }]
  })
  return { rows, skipped }
}
