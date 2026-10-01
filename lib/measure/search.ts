// Поиск замера по адресу, телефону, номеру заказа, клиенту, «что мерить» — фильтры
// PostgREST для .or(). Каждое слово должно найтись хоть в одном поле (слова — через И).
// Телефон в базе записан как угодно («+7 (926) 418-69-72», «89264186972»), поэтому
// цифры ищем с любыми знаками между ними.

import { addDays, mskToIso } from '@/lib/measure/slots'

const TEXT_FIELDS = ['address', 'client_name', 'deal_number', 'scope', 'notes', 'phone']

export function searchWords(q: string): string[] {
  return q.split(/[^\p{L}\p{N}-]+/u)
    .map(w => w.replace(/^-+|-+$/g, ''))
    .filter(w => w.length >= 2)
    .slice(0, 5)
}

export function searchFilters(q: string): string[] {
  return searchWords(q).map(w => {
    const digits = w.replace(/\D/g, '')
    if (/^\d+$/.test(w) && digits.length >= 4) {
      return [`phone.ilike.*${digits.split('').join('*')}*`, `deal_number.ilike.*${w}*`, `address.ilike.*${w}*`].join(',')
    }
    return TEXT_FIELDS.map(f => `${f}.ilike.*${w}*`).join(',')
  })
}

// Период по дате замера, а у заявок без времени — по дате создания. Даты — МСК, включительно.
export function periodFilter(from: string, to: string): string {
  const a = `"${mskToIso(from, '00:00')}"`
  const b = `"${mskToIso(addDays(to, 1), '00:00')}"`
  return `and(scheduled_at.gte.${a},scheduled_at.lt.${b}),and(scheduled_at.is.null,created_at.gte.${a},created_at.lt.${b})`
}
