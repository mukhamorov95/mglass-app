// Просчёт до заказчика (просьба владельца 07.10): запрос с Авито считают и отвечают ценой,
// не заводя клиента; заказчика привязывают, когда человек говорит «заказываю». Без него
// в работу не запускается. Две независимые оси, обе в notes заказа:
//   lead_source   — откуда пришёл (тот же список, что b2b_clients.crm_source);
//   customer_kind — кто он: розница или опт (с Авито приходит и опт).
// lead_contact — как назвать человека в ответе, пока карточки нет.

import { B2B_SOURCES, sourceLabel } from '@/lib/types'
import { computeInvoiceTotals, type InvoiceOrder } from '@/lib/b2b/invoiceMath'

export const CUSTOMER_KINDS = [
  { value: 'retail', label: 'Розница' },
  { value: 'wholesale', label: 'Опт' },
] as const
export type CustomerKind = typeof CUSTOMER_KINDS[number]['value']

export type QuoteLead = { source: string | null; kind: CustomerKind | null; contact: string | null }

export const LEAD_NOTE_KEYS = ['lead_source', 'customer_kind', 'lead_contact'] as const

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function readQuoteLead(notes: Record<string, unknown>): QuoteLead {
  const source = str(notes.lead_source)
  const kind = str(notes.customer_kind)
  return {
    source: source && B2B_SOURCES.some(s => s.value === source) ? source : null,
    kind: kind === 'retail' || kind === 'wholesale' ? kind : null,
    contact: str(notes.lead_contact),
  }
}

export function leadNotesPatch(lead: QuoteLead): Record<(typeof LEAD_NOTE_KEYS)[number], string | null> {
  return { lead_source: lead.source, customer_kind: lead.kind, lead_contact: lead.contact?.slice(0, 120) ?? null }
}

// Проверка значений, которые калькулятор пишет в notes через сервер.
export function leadNoteError(key: string, value: unknown): string | null {
  if (value === null) return null
  if (key === 'lead_source' && !B2B_SOURCES.some(s => s.value === value)) return 'Неизвестный источник'
  if (key === 'customer_kind' && value !== 'retail' && value !== 'wholesale') return 'Розница или опт'
  if (key === 'lead_contact' && (typeof value !== 'string' || value.length > 120)) return 'Контакт — строка до 120 символов'
  return null
}

// client_name обязателен в базе: без карточки — имя из чата или «Без заказчика».
export const noClientName = (contact: string | null) => contact?.trim() || 'Без заказчика'

export function quoteLeadChips(lead: QuoteLead, hasClient: boolean): string[] {
  const out: string[] = []
  if (lead.source) out.push(sourceLabel(lead.source))
  if (lead.kind) out.push(lead.kind === 'retail' ? 'розница' : 'опт')
  if (!hasClient) out.push('без заказчика')
  return out
}

// Что мешает сохранить просчёт без заказчика: без отметки «откуда» и «кто» он не структурирован.
export function noClientSaveBlocker(lead: QuoteLead): string | null {
  if (!lead.source) return 'Откуда пришёл?'
  if (!lead.kind) return 'Розница или опт?'
  return null
}

// Общее у позиции калькулятора и сохранённого заказа — ровно эти поля.
export type ClientTextItem = {
  materialName?: string | null; thickness?: number | null; width?: number | null; height?: number | null
  quantity?: number | null; hasTempering?: boolean | null; hasFacet?: boolean | null; facetTypeMm?: number | null
  services?: { name: string; cost?: number | null }[] | null
}

export function clientItemName(it: ClientTextItem): string {
  const parts = [`${(it.materialName || 'Стекло').trim()}${it.thickness ? ` ${it.thickness} мм` : ''}`]
  if (it.hasTempering) parts.push('закалённое')
  if (it.hasFacet) parts.push(it.facetTypeMm ? `фацет ${it.facetTypeMm} мм` : 'фацет')
  for (const s of it.services ?? []) if (s.name && (s.cost ?? 0) > 0) parts.push(s.name.trim().toLowerCase())
  return parts.join(', ')
}

const rub = (n: number) => {
  const r = Math.round(n * 100) / 100
  return (Number.isInteger(r) ? r.toLocaleString('ru-RU') : r.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + ' ₽'
}

function workingDays(n: number): string {
  const m10 = n % 10, m100 = n % 100
  const word = m10 === 1 && m100 !== 11 ? 'рабочий день' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'рабочих дня' : 'рабочих дней'
  return `${n} ${word}`
}

// Ответ в чат Авито (или любой мессенджер): коротко — что, сколько стоит, когда, где забрать.
// Внутреннего (себестоимость, маржа, площадь, вес) здесь нет по построению.
export function buildClientQuoteText(input: {
  items: ClientTextItem[]; lineTotals: number[]; total: number
  productionDays: number | null; contact: string | null; kind: CustomerKind | null
}): string {
  const { items, lineTotals, total, productionDays, contact, kind } = input
  const name = contact?.split(/[,(·]/)[0].trim()
  const out = [name ? `Здравствуйте, ${name}!` : 'Здравствуйте!', 'Посчитали ваш заказ:', '']
  items.forEach((it, i) => {
    const size = it.width && it.height ? ` — ${it.width}×${it.height} мм` : ''
    const qty = `${Number(it.quantity) || 1} шт.`
    const line = `${clientItemName(it)}${size}, ${qty} — ${rub(lineTotals[i] ?? 0)}`
    out.push(items.length > 1 ? `${i + 1}. ${line}` : line)
  })
  out.push('', `Итого: ${rub(total)}${kind === 'wholesale' ? ' с НДС' : ''}`)
  if (productionDays && productionDays > 0) out.push(`Срок изготовления — ${workingDays(productionDays)}.`)
  out.push('Забрать можно в Мытищах, доставка — по договорённости.')
  out.push('Если всё подходит — напишите, оформим заказ.')
  return out.join('\n')
}

// Ответы вдогонку к расчёту — без приветствия: оно уже было в тексте с ценой.
// Владелец 07.10: мебельному ателье — предложить назвать свою цену (могут заказывать
// постоянно); Дмитрию, который просит быстрее, — сначала форма оплаты, от неё зависит запуск.
export const LEAD_REPLY_TEMPLATES = [
  {
    key: 'partner', label: '📋 Предложить партнёрство',
    text: 'Кстати, если вы уже работаете с какой-то стекольной компанией и у вас есть своя цена — напишите её. Мы сейчас ищем постоянных партнёров, и с вами было бы интересно работать регулярно. Назовите цену, которая вам комфортна, — обсудим.',
  },
  {
    key: 'payment', label: '📋 Спросить оплату',
    text: 'Да, можем ускорить. Подскажите, как вам удобнее оплатить: по счёту от организации или как частное лицо? Как только оплата пройдёт, поставим заказ в работу в первую очередь и скажем точный день готовности.',
  },
] as const

// Тот же текст по сохранённому просчёту — суммы строк как в счёте (computeInvoiceTotals).
export function clientQuoteTextFromOrder(order: InvoiceOrder, notes: Record<string, unknown>): string {
  const { items, lineSums, totalPay } = computeInvoiceTotals(order)
  const lead = readQuoteLead(notes)
  return buildClientQuoteText({
    items, lineTotals: lineSums, total: totalPay,
    productionDays: Number(notes.production_days) || null,
    contact: lead.contact, kind: lead.kind,
  })
}
