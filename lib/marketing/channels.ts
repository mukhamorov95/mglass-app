// Канал заявки по сделке amoCRM — тег, поле «Источник сделки», utm и воронка.
// Признаки взяты из живых сделок 19.11.2026 (amo только на чтение): списка источников
// в amo нет единого, менеджеры ставят то тег, то поле, поэтому смотрим на всё сразу.

export const QUALIFICATION_PIPELINE = 8060186
const WON = 142
const LOST = 143

export type ChannelKey =
  | 'zerkala' | 'mglassPro' | 'peregorodki' | 'siteMessengers' | 'envybox' | 'envyboxChat'
  | 'ai' | 'avito' | 'partners' | 'calls' | 'instagram' | 'repeat' | 'other'

export const CHANNELS: { key: ChannelKey; label: string; site?: string; hint: string }[] = [
  { key: 'zerkala', label: 'Сайт зеркал', site: 'mglass-zerkala.ru', hint: 'тег «сайт-зеркала» — форма amo на сайте' },
  { key: 'mglassPro', label: 'mglass.pro', site: 'mglass.pro', hint: 'поле «Источник» = сайт mglass.pro, тег Mglass.pro или utm_referrer' },
  { key: 'peregorodki', label: 'Сайт перегородок', site: 'стеклянные-перегородки.рф', hint: 'поле «Источник» = сайт стеклянные-перегородки.рф' },
  { key: 'siteMessengers', label: 'WhatsApp / Telegram с сайта', hint: 'поле «Источник» = Ватсап/Телеграмм с сайта' },
  { key: 'envybox', label: 'Envybox — обратный звонок', site: 'mglass.pro', hint: 'тег «ЭнвиБокс» или поле «Источник» = Энвибокс' },
  { key: 'envyboxChat', label: 'Envybox — чат', site: 'mglass.pro', hint: 'сделка «Сделка #…» в воронке «Квалификация»' },
  { key: 'ai', label: 'Нейросети', hint: 'utm_source = chatgpt.com и другие ИИ' },
  { key: 'avito', label: 'Авито', hint: 'тег или поле «Авито»' },
  { key: 'partners', label: 'Партнёры, дизайнеры, рекомендации', hint: 'тег или поле: Партнёр, Дизайнер, Рекомендация' },
  { key: 'calls', label: 'Входящие звонки', hint: 'тег «Входящий» или поле «Звонок Входящий…»' },
  { key: 'instagram', label: 'Инстаграм', hint: 'тег или поле «Инстаграм»' },
  { key: 'repeat', label: 'Повторный заказ', hint: 'тег или поле «Повторный заказ»' },
  { key: 'other', label: 'Без признака', hint: 'ни тега, ни поля — канал не определить' },
]

export type AmoLeadLite = {
  id: number
  name: string
  pipeline_id: number
  status_id: number
  created_at: number
  custom_fields_values?: { field_name: string; values: { value: unknown }[] }[] | null
  _embedded?: { tags?: { name: string }[] }
}

const AI_SOURCES = /chatgpt|openai|perplexity|claude|gemini|copilot|deepseek|alice|giga/i

export function channelOf(l: AmoLeadLite): ChannelKey {
  const tags = (l._embedded?.tags ?? []).map((t) => t.name.toLowerCase().trim())
  const fields = (l.custom_fields_values ?? []).flatMap((f) => f.values.map((v) => ({ name: f.field_name.toLowerCase(), value: String(v.value ?? '').toLowerCase().replace(/\s+/g, ' ').trim() })))
  const source = fields.filter((f) => f.name.includes('источник')).map((f) => f.value)
  const utmSource = fields.filter((f) => f.name === 'utm_source').map((f) => f.value)
  const referrer = fields.filter((f) => f.name.includes('referrer')).map((f) => f.value)
  const has = (re: RegExp) => tags.some((t) => re.test(t)) || source.some((s) => re.test(s))

  if (l.pipeline_id === QUALIFICATION_PIPELINE && /^сделка #/i.test(l.name)) return 'envyboxChat'
  if (tags.includes('сайт-зеркала')) return 'zerkala'
  if (has(/энвибокс|envybox/)) return 'envybox'
  if (utmSource.some((s) => AI_SOURCES.test(s))) return 'ai'
  if (has(/mglass\.pro/) || referrer.some((r) => r.includes('mglass.pro'))) return 'mglassPro'
  if (has(/перегородки/)) return 'peregorodki'
  if (source.some((s) => /ватсап|телеграм/.test(s))) return 'siteMessengers'
  if (has(/авито/)) return 'avito'
  if (has(/партн[её]р|дизайнер|рекомендац/)) return 'partners'
  if (has(/инстаграм/)) return 'instagram'
  if (has(/повторн/)) return 'repeat'
  if (has(/входящий|звонок/)) return 'calls'
  return 'other'
}

// Начало периода в секундах unix — для фильтра amo filter[created_at][from].
export function periodStart(days: number, now = Date.now()): number {
  return Math.floor(now / 1000) - days * 86400
}

export type ChannelRow = { key: ChannelKey; total: number; open: number; won: number; lost: number; stuckQualification: number }

export function aggregate(leads: AmoLeadLite[]): ChannelRow[] {
  const rows = new Map<ChannelKey, ChannelRow>()
  for (const c of CHANNELS) rows.set(c.key, { key: c.key, total: 0, open: 0, won: 0, lost: 0, stuckQualification: 0 })
  for (const l of leads) {
    const r = rows.get(channelOf(l))!
    r.total++
    if (l.status_id === WON) r.won++
    else if (l.status_id === LOST) r.lost++
    else r.open++
    if (l.pipeline_id === QUALIFICATION_PIPELINE && l.status_id !== WON && l.status_id !== LOST) r.stuckQualification++
  }
  return CHANNELS.map((c) => rows.get(c.key)!)
}
