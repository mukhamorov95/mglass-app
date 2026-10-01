// Сообщение заявки на замер — то, что менеджер копирует замерщику в Telegram.
// Собирается из полей заявки в момент копирования, а не хранится готовым: так
// в нём всегда текущее время и замерщик, и одинаково выглядят заявки из всех трёх
// мест создания (форма «Заявки на замер», карточка сделки, карточка лида CRM).

import { phoneKey } from '@/lib/b2c/phoneKey'

export type MeasureFields = {
  deal_number?: string | null
  client_name?: string | null
  phone?: string | null
  amo_url?: string | null
  address?: string | null
  scope?: string | null
  notes?: string | null
  visit_price?: number | string | null
  payer?: string | null
  is_repeat?: boolean | null
}

export type MeasureMessageInput = MeasureFields & {
  scheduled_at?: string | null
  duration_min?: number | null
  measurer_name?: string | null
  manager_name?: string | null
}

// Пробелы внутри скобок и перед запятой — следы ручного ввода, в сообщении они
// выглядят как кривая вёрстка: «Шамиль ( НО СВЯЗЬ С ПАШЕЙ)» → «Шамиль (НО СВЯЗЬ С ПАШЕЙ)».
export function tidy(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

// Слово, с которого начинается новое изделие после запятой. Запятая внутри
// одного изделия («Зеркало 900×2200, от стены до зелёной зоны») так не режется.
const PRODUCT_START = /^(зеркал|душев|перегородк|стекл|стеклянн|двер|полк|фартук|огражден|лофт|козыр|витрин|панел|перил|кабин)/i

function cleanItem(s: string): string {
  const t = tidy(s).replace(/^[-–—•*·]+\s*/, '').replace(/^\d+[.)]\s+/, '').replace(/[,;.\s]+$/, '')
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

// «Что мерить» — список изделий. Менеджер пишет его как угодно: строками, через
// «- » в одну строку, через «;», перечислением через запятую. Возвращаем по
// одному изделию на элемент.
export function splitScope(scope: string | null | undefined): string[] {
  const out: string[] = []
  for (const line of String(scope ?? '').split(/\r?\n/)) {
    // Маркер списка в начале строки или после запятой/точки с запятой.
    const bullets = line.split(/(?:^|[,;])\s*[-–—•*]\s+|;\s*/)
    for (const chunk of bullets) {
      let buf = ''
      for (const part of chunk.split(',')) {
        if (buf && PRODUCT_START.test(part.trim())) { out.push(buf); buf = part }
        else buf = buf ? `${buf},${part}` : part
      }
      if (buf) out.push(buf)
    }
  }
  return out.map(cleanItem).filter(Boolean)
}

// Номер одной строкой без пробелов: так Telegram и WhatsApp делают его ссылкой
// «позвонить», а «+7 (926) 418-69-72» распознают не везде.
export function messagePhone(raw: string | null | undefined): string {
  const k = phoneKey(raw)
  return k ? `+7${k}` : tidy(raw)
}

const MSK_OFFSET_MS = 3 * 3600_000
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

// «чт 2 окт, 12:00–13:30» по Москве — независимо от часового пояса браузера.
export function formatMeasureWhen(iso: string, durationMin?: number | null): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const d = new Date(t + MSK_OFFSET_MS)
  const end = durationMin && durationMin > 0 ? new Date(t + MSK_OFFSET_MS + durationMin * 60_000) : null
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hhmm(d)}${end ? `–${hhmm(end)}` : ''}`
}

function visitLine(price: number, payer: string): string {
  if (price > 0) return `${price.toLocaleString('ru-RU').replace(/ /g, ' ')} ₽${payer ? ` · платит ${payer}` : ''}`
  return payer || 'цена не указана'
}

export function buildMeasureMessage(p: MeasureMessageInput): string {
  const items = splitScope(p.scope)
  const price = Number(String(p.visit_price ?? '').replace(/\s/g, '')) || 0
  const payer = tidy(p.payer)
  const notes = tidy(p.notes)
  const deal = tidy(p.deal_number)

  const head = `${p.is_repeat ? '🔁 ЗАМЕР ПОВТОРНЫЙ' : '📐 ЗАМЕР НОВЫЙ'}${deal ? ` · ${deal}` : ''}`

  const who = [
    `👤 Клиент: ${tidy(p.client_name) || '—'}`,
    p.phone ? `📞 Телефон: ${messagePhone(p.phone)}` : '',
    `📍 Адрес: ${tidy(p.address) || '—'}`,
  ].filter(Boolean)

  const what = items.length > 1
    ? ['📏 Что мерить:', ...items.map((it, i) => `${i + 1}. ${it}`)]
    : [`📏 Что мерить: ${items[0] ?? '—'}`]

  const when = p.scheduled_at
    ? `${formatMeasureWhen(p.scheduled_at, p.duration_min)}${p.measurer_name ? ` · ${tidy(p.measurer_name)}` : ''}`
    : 'не назначено — договориться с клиентом'

  const terms = [
    notes ? `💬 Примечание: ${notes}` : '',
    `💰 Выезд: ${visitLine(price, payer)}`,
    `🗓 Когда: ${when}`,
    p.manager_name ? `👔 Менеджер: ${tidy(p.manager_name)}` : '',
    p.amo_url ? `🔗 amoCRM: ${p.amo_url.trim()}` : '',
  ].filter(Boolean)

  return [head, who.join('\n'), what.join('\n'), terms.join('\n')].join('\n\n')
}

// Маршрут дня в Яндекс.Картах: от того места, где замерщик сейчас, по адресам в
// порядке времени. Пустая первая точка — «моё местоположение».
export function dayRouteUrl(addresses: (string | null | undefined)[]): string | null {
  const pts = addresses.map(a => tidy(a)).filter(Boolean)
  if (!pts.length) return null
  return `https://yandex.ru/maps/?rtext=~${pts.map(encodeURIComponent).join('~')}&rtt=auto`
}

// Предупредить клиента перед выездом: готовый текст в WhatsApp. Отправляет сам
// замерщик со своего телефона — приложение только собирает ссылку.
export function clientHeadsUpText(p: { measurer_name?: string | null; scheduled_at: string; address?: string | null; today: string }): string {
  const d = new Date(new Date(p.scheduled_at).getTime() + MSK_OFFSET_MS)
  const date = d.toISOString().slice(0, 10)
  const tomorrow = new Date(new Date(`${p.today}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
  const day = date === p.today ? 'сегодня' : date === tomorrow ? 'завтра' : `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  const who = tidy(p.measurer_name) ? `${tidy(p.measurer_name)}, замерщик M-Glass` : 'замерщик M-Glass'
  const where = tidy(p.address) ? ` по адресу ${tidy(p.address)}` : ''
  return `Здравствуйте! Это ${who}. Буду у вас ${day} в ${hhmm(d)}${where}. Если планы поменялись — напишите или позвоните, пожалуйста.`
}

export function whatsAppUrl(phone: string | null | undefined, text: string): string | null {
  const k = phoneKey(phone)
  return k ? `https://wa.me/7${k}?text=${encodeURIComponent(text)}` : null
}
