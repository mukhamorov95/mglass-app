// Разбор тела публичной заявки (/api/configurator/lead): 3D-виджет, Tilda и
// сайт зеркал шлют разный набор полей. Чистая функция — чтобы правила приёма
// проверялись тестом, а не тестовыми заявками владельцу в Telegram.

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

// Телефон принимаем как введён, но проверяем, что цифр достаточно: иначе форму
// заполняет бот, а менеджер тратит время на «звонок» по строке из букв.
const digits = (s: string) => (s.match(/\d/g) ?? []).length

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'yclid'] as const

export type SiteLeadRow = { name: string; phone: string; comment: string; context: string; source: string }

export type ParsedLead =
  | { kind: 'bot' }
  | { kind: 'invalid'; error: string }
  | { kind: 'ok'; row: SiteLeadRow; message: string }

export function parseLead(body: unknown): ParsedLead {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  // Скрытое поле формы: человек его не видит, бот заполняет. Отвечаем «ок»,
  // чтобы бот не подбирал обход, но ничего не пишем и никого не будим.
  if (clean(b.website, 200)) return { kind: 'bot' }

  const phone = clean(b.phone, 32)
  if (digits(phone) < 10) return { kind: 'invalid', error: 'Нужен телефон' }

  const name = clean(b.name, 120)
  const product = clean(b.product, 80)
  const sizes = clean(b.sizes, 200)
  const userComment = clean(b.comment, 600)
  const context = clean(b.context, 300) || clean(b.page, 300)
  const source = clean(b.source, 40) || 'site'

  const utmRaw = (b.utm && typeof b.utm === 'object' ? b.utm : {}) as Record<string, unknown>
  const utm = UTM_KEYS.map(k => [k, clean(utmRaw[k], 100)] as const).filter(([, v]) => v)
  const utmLine = utm.length ? `Метки: ${utm.map(([k, v]) => `${k}=${v}`).join(', ')}` : ''

  const comment = [
    product && `Изделие: ${product}`,
    sizes && `Размеры: ${sizes}`,
    userComment,
    utmLine,
  ].filter(Boolean).join('\n')

  const message = [
    '🔔 Заявка с сайта',
    name ? `Имя: ${name}` : null,
    `Телефон: ${phone}`,
    product ? `Изделие: ${product}` : null,
    sizes ? `Размеры: ${sizes}` : null,
    context ? `Страница: ${context}` : null,
    userComment ? `Комментарий: ${userComment}` : null,
    utmLine || null,
  ].filter(Boolean).join('\n')

  return { kind: 'ok', row: { name, phone, comment, context, source }, message }
}
