// Что делают с деталью сверх резки и полировки — из признаков позиции и из услуг калькулятора.
// Услугу менеджер выбирает ради цены, а признак маршрута стоит отдельным переключателем, и его
// не ставят: за 120 дней ни у одной детали с услугой пескоструя нет признака «Песочка», и заказ
// 05669 (09.10) ушёл в цех без песочки по макету. Поэтому этап цеха и строка детали
// в производственном сообщении берутся из обоих источников, а не из одного переключателя.

type ServiceLike = { id?: number | null; name?: string | null }

export type TreatmentItem = {
  hasSandblast?: boolean | null
  hasFacet?: boolean | null
  facetTypeMm?: number | null
  hasHoles?: boolean | null
  holes?: unknown
  hasCutouts?: boolean | null
  cutouts?: number | null
  shape?: string | null
  hasTriplex?: boolean | null
  triplexLayers?: number | null
  services?: ServiceLike[] | null
  comment?: string | null
}

const servicesOf = (item: TreatmentItem): ServiceLike[] => (Array.isArray(item.services) ? item.services : [])

// Пескоструй по трафарету, сплошное матирование, матовка под сенсорную кнопку — всё это
// станция песочки (макет → оракал → пескоструй), до закалки.
const SANDBLAST = /пескостру|матирован|матовк/i

export function needsSandblast(item: TreatmentItem): boolean {
  return item.hasSandblast === true || servicesOf(item).some(s => SANDBLAST.test(s.name ?? ''))
}

// Короткие подписи услуг для цеха. Наценки за габарит — деньги, а не работа: размер и так
// стоит в строке детали, поэтому они не подписываются.
const SERVICE_TAGS: Array<[RegExp, string | null]> = [
  [/крупногабарит|широкая деталь|сложная форма|длиной от 3000/i, null],
  [/пескостру.*(трафарет|рисун|частичн)/i, 'песочка по трафарету'],
  [/матирован/i, 'песочка сплошная'],
  [/матовка под сенсорн/i, 'матовка под кнопку'],
  [/фигурн/i, 'фигурная'],
  [/непрямоугольн/i, 'непрямоугольная'],
  [/т и г образн/i, 'Т/Г-образная'],
  [/триплекс/i, 'триплекс'],
  [/пл[её]нк/i, 'плёнка'],
  [/полимерн/i, 'полимерное покрытие'],
  [/макет/i, 'макет'],
  [/оцифровк/i, 'оцифровка шаблона'],
  [/черт[её]ж/i, 'чертёж'],
]

export function serviceTag(name: string): string | null {
  for (const [re, tag] of SERVICE_TAGS) if (re.test(name)) return tag
  const short = name.replace(/\s*\([^)]*\)/g, '').trim()
  return short ? short[0].toLowerCase() + short.slice(1) : null
}

function holeGroups(raw: unknown): { d: number; n: number }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(x => ({ d: Math.round(Number((x as { d?: unknown })?.d) || 0), n: Math.round(Number((x as { n?: unknown })?.n) || 0) }))
    .filter(g => g.d > 0 && g.n > 0)
}

// Подписи для строки детали: «фацет 10 мм, отв. 4×⌀12, песочка по трафарету, макет».
export function treatmentTags(item: TreatmentItem): string[] {
  const tags: string[] = []
  if (item.shape === 'curved') tags.push('криволинейная')
  if (item.hasFacet) tags.push(item.facetTypeMm ? `фацет ${item.facetTypeMm} мм` : 'фацет')
  const holes = holeGroups(item.holes)
  if (holes.length) tags.push(`отв. ${holes.map(g => `${g.n}×⌀${g.d}`).join(', ')}`)
  else if (item.hasHoles === true) tags.push('отверстия (размеры не указаны)')
  const cut = Math.round(Number(item.cutouts) || 0)
  if (cut > 0) tags.push(`вырезы ×${cut}`)
  else if (item.hasCutouts) tags.push('вырезы')
  if (item.hasTriplex) tags.push(item.triplexLayers === 3 ? 'триплекс (3 стекла)' : 'триплекс')
  const fromServices = servicesOf(item).map(s => serviceTag(s.name ?? '')).filter((t): t is string => !!t)
  if (item.hasSandblast && !fromServices.some(t => /песочк|матовк/.test(t))) tags.push('песочка')
  for (const t of fromServices) if (!tags.some(x => x.startsWith(t))) tags.push(t)
  return tags
}

// Комментарий позиции часто начинается с того же размера («750×1900 мм · лента …») — без повтора.
export function itemNote(comment: string | null | undefined): string | null {
  const c = (comment ?? '').replace(/^\s*\d+\s*[×xх]\s*\d+\s*мм\s*·?\s*/i, '').trim()
  return c || null
}
