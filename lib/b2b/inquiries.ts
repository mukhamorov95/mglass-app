import { B2B_SOURCES } from '@/lib/types'

// Входящие заявки B2B (b2b_inquiries): заявка с Авито и других каналов до того, как стала
// клиентом. Здесь только чистая логика; статусы и источники повторяют check-ограничения
// миграции 20261002_b2b_inquiries.sql — менять вместе.

export const INQUIRY_STATUSES = [
  { value: 'new',      label: 'Новая',     color: 'bg-red-50 text-red-700' },
  { value: 'answered', label: 'Ответили',  color: 'bg-amber-50 text-amber-700' },
  { value: 'quoted',   label: 'Посчитали', color: 'bg-blue-50 text-blue-700' },
  { value: 'won',      label: 'Заказ',     color: 'bg-emerald-50 text-emerald-700' },
  { value: 'lost',     label: 'Отказ',     color: 'bg-[#f0f0ec] text-[#6b6b66]' },
] as const
export type InquiryStatus = typeof INQUIRY_STATUSES[number]['value']
export const OPEN_STATUSES: InquiryStatus[] = ['new', 'answered', 'quoted']

export type Inquiry = {
  id: number
  created_at: string
  updated_at: string
  source: string
  contact_name: string | null
  company: string | null
  phone: string | null
  request: string | null
  chat_url: string | null
  listing: string | null
  status: InquiryStatus
  answered_at: string | null
  closed_at: string | null
  lost_reason: string | null
  b2b_client_id: number | null
  created_by: string | null
  assigned_to: string | null
  // Заявки из чатов GLASMEN (вебхук Авито); у заведённых руками — пусто.
  avito_chat_id?: string | null
  last_message_at?: string | null
}

// Первый ответ на Авито нужен за 30 минут: от него зависят уровень сервиса и сама сделка.
export const ANSWER_SLA_MIN = 30

const LIMITS = { contact_name: 120, company: 160, phone: 40, request: 2000, chat_url: 500, listing: 200, lost_reason: 300 } as const
type TextField = keyof typeof LIMITS

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/\s+/g, ' ')
  return s ? s.slice(0, max) : null
}

// Ссылка на чат — только https: в карточке она становится href.
const cleanUrl = (v: unknown): string | null => {
  const s = clean(v, LIMITS.chat_url)
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' ? u.toString() : null
  } catch { return null }
}

export type InquiryInput = Partial<Record<TextField, string | null>> & { source?: string }

export function normalizeInquiryInput(body: Record<string, unknown>): { ok: true; value: InquiryInput } | { ok: false; error: string } {
  const value: InquiryInput = {}
  for (const k of Object.keys(LIMITS) as TextField[]) {
    if (k === 'chat_url' || k === 'request') continue
    if (k in body) value[k] = clean(body[k], LIMITS[k])
  }
  if ('chat_url' in body) {
    value.chat_url = cleanUrl(body.chat_url)
    if (body.chat_url && !value.chat_url) return { ok: false, error: 'Ссылка на чат — полный адрес https://…' }
  }
  if ('request' in body && typeof body.request === 'string') {
    // Перевод строки в запросе клиента — часть смысла (список размеров), его не схлопываем.
    const s = body.request.trim()
    value.request = s ? s.slice(0, LIMITS.request) : null
  }
  if ('source' in body) {
    const s = String(body.source ?? '')
    if (!B2B_SOURCES.some(x => x.value === s)) return { ok: false, error: 'Неизвестный источник' }
    value.source = s
  }
  return { ok: true, value }
}

export const hasWho = (v: Pick<InquiryInput, 'contact_name' | 'company' | 'phone' | 'chat_url'>) =>
  !!(v.contact_name || v.company || v.phone || v.chat_url)

// Переход статуса → поля, которые меняются вместе с ним. Время первого ответа ставится один
// раз и не переписывается: по нему считается скорость реакции.
export function statusPatch(cur: Pick<Inquiry, 'status' | 'answered_at'>, next: InquiryStatus, nowIso: string, lostReason?: string | null) {
  const patch: Record<string, unknown> = { status: next }
  if (next !== 'new' && !cur.answered_at) patch.answered_at = nowIso
  if (next === 'won' || next === 'lost') patch.closed_at = nowIso
  else patch.closed_at = null
  patch.lost_reason = next === 'lost' ? (lostReason ?? null) : null
  return patch
}

export const isInquiryStatus = (s: unknown): s is InquiryStatus =>
  typeof s === 'string' && INQUIRY_STATUSES.some(x => x.value === s)

export const inquiryTitle = (i: Pick<Inquiry, 'company' | 'contact_name' | 'phone' | 'id'>) =>
  i.company || i.contact_name || i.phone || `Заявка №${i.id}`

export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000))
}

// «12 мин», «3 ч 5 мин», «2 дн» — возраст новой заявки или время до ответа.
export function durationLabel(min: number): string {
  if (min < 60) return `${min} мин`
  if (min < 24 * 60) {
    const h = Math.floor(min / 60), m = min % 60
    return m ? `${h} ч ${m} мин` : `${h} ч`
  }
  return `${Math.floor(min / (24 * 60))} дн`
}

export const isOverdue = (i: Pick<Inquiry, 'status' | 'created_at'>, nowIso: string) =>
  i.status === 'new' && minutesBetween(i.created_at, nowIso) > ANSWER_SLA_MIN
