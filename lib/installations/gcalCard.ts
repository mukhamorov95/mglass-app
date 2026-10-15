// Карточка монтажа из Google Календаря офиса (mglass.ceo@gmail.com) → строка installations.
// Карточку пишут руками по одной форме — «Время, Номер заказа, Бригада, Изделие, ФИО, Адрес,
// Пропуск, телефон, сумма монтажа», — но то таблицей (HTML), то столбиком текста, с пустыми
// строками, переносами внутри ячеек и пометками в скобках. Разбор не угадывает: что не
// легло в поле, уходит в comment / amount_note дословно. В том же календаре личные события
// (поездки, «набрать») — карточкой считается только событие с полями «Номер заказа» и «Бригада».

export type InstallKind = 'install' | 'claim' | 'rework' | 'stage'

export type GcalEventLike = {
  id: string
  summary?: string | null
  description?: string | null
  start?: { dateTime?: string | null; date?: string | null } | null
  updated?: string | null
  status?: string | null
}

export type CalendarCard = {
  external_key: string
  order_no: string
  order_nos: string[]
  title: string | null
  kind: InstallKind
  client_name: string | null
  phone: string | null
  address: string | null
  entry_note: string | null
  scheduled_date: string
  time_from: string | null
  time_to: string | null
  contact_before: string | null
  crew_members: string[]
  amount: number | null
  amount_note: string | null
  comment: string | null
  source_updated_at: string | null
}

const LABELS: Record<string, keyof Fields> = {
  'время': 'time', 'номер заказа': 'order_no', 'бригада': 'crew', 'изделие': 'product', 'фио': 'client',
  'адрес': 'address', 'пропуск': 'entry', 'телефон': 'phone', 'сумма монтажа': 'amount',
}
type Fields = { time?: string; order_no?: string; crew?: string; product?: string; client?: string; address?: string; entry?: string; phone?: string; amount?: string }
export type CardFields = Fields & { extra: string[] }

const decode = (s: string) => s
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&')
const clean = (s: string) => s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()
const labelOf = (s: string) => LABELS[clean(s).toLowerCase().replace(/:$/, '')]

export function cardFields(description: string | null | undefined): CardFields {
  const out: CardFields = { extra: [] }
  const desc = description ?? ''
  if (!desc.trim()) return out
  const put = (k: keyof Fields, v: string) => { if (out[k] == null || out[k] === '') out[k] = v }

  if (/<t[rd][\s>]/i.test(desc)) {
    const text = decode(desc
      .replace(/\s*\n\s*/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/td>\s*<td[^>]*>/gi, '\t')
      .replace(/<\/tr>/gi, '\u001e')
      .replace(/<[^>]+>/g, ''))
    for (const row of text.split('\u001e')) {
      const [c0 = '', c1 = ''] = row.split('\t')
      const labels = c0.split('\n').map(clean).filter(Boolean)
      const values = c1.split('\n').map(clean).filter(Boolean)
      if (labels.length === 0) { if (values.length) out.extra.push(values.join(' ')); continue }
      // «телефон / сумма монтажа» бывают слиты в одну строку таблицы
      if (labels.length > 1 && labels.length === values.length && labels.every(labelOf)) {
        labels.forEach((l, i) => put(labelOf(l), values[i]))
        continue
      }
      const k = labelOf(labels[0])
      if (k) put(k, values.join(' '))
      else out.extra.push([...labels, ...values].join(' '))
    }
  } else {
    const lines = decode(desc).split('\n').map(clean)
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (!l) continue
      const inline = /^сумма монтажа\s*:?\s+(.+)$/i.exec(l)
      if (inline) { put('amount', inline[1]); continue }
      const k = labelOf(l)
      if (k) {
        let j = i + 1
        while (j < lines.length && !lines[j]) j++
        if (j < lines.length && !labelOf(lines[j])) { put(k, lines[j]); i = j }
        continue
      }
      out.extra.push(l)
    }
  }
  // «телефон … сумма монтажа 20.000» в одной ячейке
  const inPhone = out.phone ? /сумма монтажа\s*:?\s*(.+)$/i.exec(out.phone) : null
  if (inPhone && out.phone) {
    if (!out.amount) out.amount = inPhone[1].trim()
    out.phone = out.phone.slice(0, inPhone.index).trim()
  }
  return out
}

const ORDER_RE = /\d{2,5}-\d+(?:-\d+)?/g

export function orderNosOf(s: string | null | undefined): string[] {
  return [...new Set((s ?? '').replace(/#/g, ' ').match(ORDER_RE) ?? [])]
}

// «9:30-10:00», «11-12:00», «10:00», «12:00-13:00» → окно ожидания
export function timeWindow(s: string | null | undefined): { from: string | null; to: string | null } {
  const parts = (s ?? '').match(/\d{1,2}(?::\d{2})?/g) ?? []
  const hm = (p: string | undefined) => {
    if (!p) return null
    const [h, m = '00'] = p.split(':')
    const hh = Number(h)
    return hh >= 0 && hh < 24 ? `${String(hh).padStart(2, '0')}:${m}` : null
  }
  return { from: hm(parts[0]), to: hm(parts[1]) }
}

// «12500(остаток налом 29670руб)» → 12500 + пометка; «15.000 (платит на месте)» → 15000;
// «20000+5000» → 25000, слагаемые остаются в пометке
export function amountOf(s: string | null | undefined): { amount: number | null; note: string | null } {
  const raw = clean(s ?? '')
  if (!raw) return { amount: null, note: null }
  const num = (t: string) => Number(t.replace(/[.\s](?=\d{3}\b)/g, ''))
  const sum = /^(\d[\d.\s]*\d|\d)(?:\s*\+\s*(\d[\d.\s]*\d|\d))+$/.exec(raw)
  if (sum) {
    const total = raw.split('+').map(t => num(t.trim())).reduce((a, b) => a + b, 0)
    return Number.isFinite(total) ? { amount: total, note: raw } : { amount: null, note: raw }
  }
  const m = /^(\d{1,3}(?:[.\s]\d{3})+|\d+)/.exec(raw)
  if (!m) return { amount: null, note: raw }
  const rest = raw.slice(m[0].length).trim()
  return { amount: num(m[0]), note: rest || null }
}

export function crewOf(s: string | null | undefined): string[] {
  return (s ?? '').replace(/\(.*$/, '').split(/[,.;/+]|\s+и\s+/).map(clean).filter(Boolean)
}

// Вид выезда — по словам офиса: в заголовке «Реклам»/«Доделка», в изделии — что чинят.
// Заголовок важнее изделия: «Доделка (заменить уплотнитель)» — доделка, не рекламация.
export function kindOf(summary: string, product: string): InstallKind {
  const byWords = (t: string): InstallKind | null => {
    if (/реклам|гарант/i.test(t)) return 'claim'
    if (/доделк|переделк|доп\b|доп\.|доп\s*выезд|демонтаж/i.test(t)) return 'rework'
    if (/этап|закладн/i.test(t)) return 'stage'
    return null
  }
  return byWords(summary) ?? byWords(product)
    ?? (/не горит|слетел|болтает|теч[её]т|села дверь|сели двери/i.test(product) ? 'claim' : 'install')
}

export function parseCalendarCard(ev: GcalEventLike): CalendarCard | null {
  if (ev.status === 'cancelled') return null
  const f = cardFields(ev.description)
  if (f.order_no === undefined || f.crew === undefined) return null
  const date = (ev.start?.dateTime ?? ev.start?.date ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

  const summary = clean(ev.summary ?? '')
  const orderCell = clean(f.order_no).replace(/^#/, '')
  const nos = orderNosOf(orderCell)
  const time = timeWindow(f.time)
  const money = amountOf(f.amount)
  const contact = /\(([^)]*(?:набрать|позвонить)[^)]*)\)/i.exec(summary)?.[1] ?? null
  const crewTail = /\((.*)$/.exec(f.crew ?? '')?.[1]
  // «вторая половина дня» — окна нет, но слова офиса не теряем
  const timeText = f.time && !time.from ? `Время: ${f.time}` : null
  const extra = [timeText, ...f.extra, crewTail ? `Бригада: ${crewTail}` : null].filter(Boolean).join('\n')

  return {
    external_key: `gcal:${ev.id}`,
    order_no: nos.length ? nos.join('+') : (orderCell || summary || '—'),
    order_nos: nos.length ? nos : orderNosOf(summary),
    title: f.product ? clean(f.product) : null,
    kind: kindOf(summary, f.product ?? ''),
    client_name: f.client || null,
    phone: f.phone || null,
    address: f.address || null,
    entry_note: f.entry || null,
    scheduled_date: date,
    time_from: time.from,
    time_to: time.to,
    contact_before: contact,
    crew_members: crewOf(f.crew),
    amount: money.amount,
    amount_note: money.note,
    comment: extra || null,
    source_updated_at: ev.updated ?? null,
  }
}
