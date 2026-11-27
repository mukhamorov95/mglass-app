// Светофор входящей заявки (этап В3 маршрута docs/avito-b2b/INQUIRY_ROUTE.md).
//
// Зачем: превью чата в кабинете Авито показывает последнюю реплику («Межкомнатные»,
// «Делаете?»), а объём лежит внутри переписки — заказ на сотни тысяч выглядит в списке
// как подрезка трёх полок. Светофор вытаскивает «сколько» и «кто это» в строку заявки.
//
// Разделение как в lib/avito/scoreLead.ts: ЧИСЛА СЧИТАЕТ КОД (воспроизводимо, тестируемо),
// сегмент — мнение модели. Уровень заявки (мелочь / партия / крупное) выводится только из
// чисел и порогов владельца, чтобы «фабрика» не зависела от настроения модели.

export const INQUIRY_SEGMENTS = [
  { value: 'private', label: 'Частник' },
  { value: 'workshop', label: 'Мастерская' },
  { value: 'manufacturer', label: 'Производство' },
  { value: 'trade', label: 'Торговое оборудование' },
  { value: 'unclear', label: 'Не ясно' },
] as const
export type InquirySegment = typeof INQUIRY_SEGMENTS[number]['value']

export const isInquirySegment = (v: unknown): v is InquirySegment =>
  typeof v === 'string' && INQUIRY_SEGMENTS.some(s => s.value === v)

export type InquiryTier = 'small' | 'batch' | 'large'
export type RepeatKind = 'once' | 'repeat' | 'unknown'

// Пороги — настройка владельца (b2b_inquiry_triage_settings), не константа в коде:
// «с какого объёма заявка промышленная» — решение 6 маршрута. Здесь стартовые значения,
// которые показываются на экране с пометкой «стартовое», пока владелец не поставил свои.
export type TierThresholds = { batchFrom: number; largeFrom: number }
export const STARTER_THRESHOLDS: TierThresholds = { batchFrom: 10, largeFrom: 50 }

export type VolumeFacts = {
  units: number | null       // сколько штук названо в переписке
  sizesCount: number         // сколько разных размеров названо
  maxSideMm: number | null   // самая длинная сторона, мм — отличает «полку» от «стекла 3 м»
}

// `\b` в JS считает границей слова только ASCII-буквы, поэтому после «шт» и «мм» он не
// срабатывает вовсе: «224 шт» не находилось. Конец слова здесь — «дальше не буква».
// `\w` в JS — только ASCII, поэтому `кром\w+` не находил «кромка», а `детал\w+` не
// находил «детали». В русских шаблонах буквы перечисляются явно.
const RU = '[а-яё]'
const NOT_LETTER = '(?![a-zа-яё])'
const DECL = `(?:штук${RU}*|шт)${NOT_LETTER}`
// «10 зеркал», «3 стекла», «9 полок» — число перед изделием во множественном числе.
const THINGS = `(?:зеркал${RU}*|стекол|стёкол|стекла|стеклянн${RU}*|полок|полки|полка|детал${RU}+|двер${RU}+|панел${RU}+|листов?|заготовок)`

const num = (s: string) => Number(s.replace(',', '.'))

// Размеры: 1425×530, 142.5 на 53, 768х150мм, 2750*1605. Русская «х» и латинская «x»
// в переписке встречаются обе, и клиенты пишут сантиметры без единиц.
const SIZE_RE = /(\d{2,5}(?:[.,]\d+)?)\s*(?:[xх×*]|\sна\s)\s*(\d{2,5}(?:[.,]\d+)?)/gi

/**
 * Числа из переписки. Только то, что человек написал явно: ничего не додумывается,
 * «не нашлось» — это null, а не 0. Ноль здесь читался бы как «заказ на ноль штук».
 */
export function extractVolume(text: string): VolumeFacts {
  const src = (text ?? '').slice(0, 4000)

  // Два независимых счёта, берём больший.
  //  — сумма явных «N шт»: «Полки (9шт) … Дверки (2шт)» это 11 деталей;
  //  — названный итог: «нужно 3 стекла», «10 зеркал».
  // Больший, потому что опечатка занижает перечисление, а итог клиент называет целиком:
  // в живом чате «142.5 на 53 1шт … 1ш т … 1шт» сумма дала 2 при трёх стёклах.
  let bySht = 0, byThing = 0
  for (const m of src.matchAll(new RegExp(`(\\d{1,5})\\s*${DECL}`, 'gi'))) bySht += Number(m[1])
  for (const m of src.matchAll(new RegExp(`(\\d{1,4})\\s+${THINGS}`, 'gi'))) byThing += Number(m[1])
  const units = Math.max(bySht, byThing)
  const found = units > 0

  const sizes: number[] = []
  for (const m of src.matchAll(SIZE_RE)) {
    const a = num(m[1]), b = num(m[2])
    // Сантиметры клиенты пишут как «142.5 на 53»: дробная часть выдаёт см, переводим в мм.
    const scale = (m[1].includes('.') || m[1].includes(',') || m[2].includes('.') || m[2].includes(',')) ? 10 : 1
    sizes.push(Math.round(Math.max(a, b) * scale))
  }

  return {
    units: found && units > 0 ? units : null,
    sizesCount: sizes.length,
    maxSideMm: sizes.length ? Math.max(...sizes) : null,
  }
}

/**
 * Уровень заявки — из чисел и порогов владельца, без модели.
 * Количество не названо → 'small': это не «мало», а «пока не знаем», и строка заявки
 * говорит это словами («объём не назван»), а не цифрой.
 */
export function tierOf(units: number | null, t: TierThresholds = STARTER_THRESHOLDS): InquiryTier {
  if (units == null) return 'small'
  if (units >= t.largeFrom) return 'large'
  if (units >= t.batchFrom) return 'batch'
  return 'small'
}

// Чего не хватает, чтобы запустить просчёт. Это и есть мерило этапа В4: пока список
// непустой, цену назвать нельзя, сколько бы сообщений ни было.
export type SpecGap = 'sizes' | 'thickness' | 'edge' | 'count'

const THICKNESS_RE = /(\d{1,2}(?:[.,]\d)?)\s*мм(?![a-zа-яё])|толщин/i
const EDGE_RE = /кром[а-яё]+|полиров[а-яё]+|шлифов[а-яё]+|фацет/i

export function specGaps(text: string, v: VolumeFacts): SpecGap[] {
  const src = (text ?? '')
  const gaps: SpecGap[] = []
  if (!v.sizesCount) gaps.push('sizes')
  if (!THICKNESS_RE.test(src)) gaps.push('thickness')
  if (!EDGE_RE.test(src)) gaps.push('edge')
  if (v.units == null) gaps.push('count')
  return gaps
}

export const GAP_LABEL: Record<SpecGap, string> = {
  sizes: 'размеры',
  thickness: 'толщина',
  edge: 'кромка',
  count: 'количество',
}

export type Triage = {
  segment: InquirySegment
  tier: InquiryTier
  units: number | null
  sizesCount: number
  maxSideMm: number | null
  repeat: RepeatKind
  gaps: SpecGap[]
  reason: string
}

export const SEGMENT_LABEL: Record<InquirySegment, string> =
  Object.fromEntries(INQUIRY_SEGMENTS.map(s => [s.value, s.label])) as Record<InquirySegment, string>

const TIER_MARK: Record<InquiryTier, string> = { small: '·', batch: '📦', large: '🏭' }

/** Строка для Telegram и для списка заявок: «🏭 Производство · 224 шт · не хватает: размеры, толщина». */
export function triageLine(t: Triage): string {
  const parts = [`${TIER_MARK[t.tier]} ${SEGMENT_LABEL[t.segment]}`]
  parts.push(t.units == null ? 'объём не назван' : `${t.units} шт`)
  if (t.repeat === 'repeat') parts.push('повторяется')
  if (t.gaps.length) parts.push(`не хватает: ${t.gaps.map(g => GAP_LABEL[g]).join(', ')}`)
  return parts.join(' · ')
}

/**
 * Сборка: числа от кода, сегмент и повторяемость — мнение модели (может отсутствовать).
 * Модель не двигает уровень заявки: её «кажется, фабрика» без чисел ничего не меняет.
 */
export function buildTriage(
  text: string,
  opinion: { segment?: unknown; repeat?: unknown } | null,
  thresholds: TierThresholds = STARTER_THRESHOLDS,
): Triage {
  const v = extractVolume(text)
  const tier = tierOf(v.units, thresholds)
  const segment: InquirySegment = isInquirySegment(opinion?.segment) ? opinion.segment : 'unclear'
  const repeat: RepeatKind = opinion?.repeat === 'once' || opinion?.repeat === 'repeat' ? opinion.repeat : 'unknown'
  const gaps = specGaps(text, v)
  const reason = v.units == null
    ? 'количество в переписке не названо'
    : `${v.units} шт — порог партии ${thresholds.batchFrom}, крупного ${thresholds.largeFrom}`
  return { segment, tier, units: v.units, sizesCount: v.sizesCount, maxSideMm: v.maxSideMm, repeat, gaps, reason }
}
