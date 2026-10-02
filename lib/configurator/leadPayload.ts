import { M_MODELS } from '@/lib/configurator/arrangement'

// Разбор тела публичной заявки (/api/configurator/lead): 3D-виджет, Tilda и
// сайт зеркал шлют разный набор полей. Чистая функция — чтобы правила приёма
// проверялись тестом, а не тестовыми заявками владельцу в Telegram.

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

// Телефон принимаем как введён, но проверяем, что цифр достаточно: иначе форму
// заполняет бот, а менеджер тратит время на «звонок» по строке из букв.
const digits = (s: string) => (s.match(/\d/g) ?? []).length

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'yclid'] as const

export type SiteLeadRow = { name: string; phone: string; comment: string; context: string; source: string }

// Состав из 3D-конструктора (Ш3): ровно то, что нужно «Расчёту», чтобы открыть тот же
// расчёт. Тело публичное — всё режется по белому списку, чужие ключи не доезжают до базы.
export type LeadConfig = {
  model: string
  name: string
  dims: { width: number; height: number; width2?: number; doorWidth?: number; trayDepth?: number; ceilingHeight?: number }
  tier: 'budget' | 'premium'
  glass: { id: string; label: string }
  finish: { id: string; label: string }
  choice: Record<string, string>
  qtyChoice: Record<string, number>
  variant: { mount?: 'perp90' | 'diag45' | 'stabilizer' | 'ceiling'; profileFrame?: 'partial' | 'perimeter' }
  priceFrom: number | null
}

export type ParsedLead =
  | { kind: 'bot' }
  | { kind: 'invalid'; error: string }
  | { kind: 'ok'; row: SiteLeadRow; message: string; config: LeadConfig | null }

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const mm = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n >= 100 && n <= 5000 ? Math.round(n) : undefined
}
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const ROLE = /^[a-z][a-z0-9-]{0,29}$/
const MOUNTS = new Set(['perp90', 'diag45', 'stabilizer', 'ceiling'])
const rub = (n: number) => `${n.toLocaleString('ru-RU').replace(/\s/g, ' ')} ₽`

export function parseLeadConfig(raw: unknown): LeadConfig | null {
  const c = obj(raw)
  const model = M_MODELS.find(m => m.code === clean(c.model, 4))
  const d = obj(c.dims)
  const width = mm(d.width), height = mm(d.height)
  if (!model || !width || !height) return null
  const dims: LeadConfig['dims'] = { width, height }
  for (const k of ['width2', 'doorWidth', 'trayDepth', 'ceilingHeight'] as const) {
    const v = mm(d[k]); if (v) dims[k] = v
  }
  const pick = (v: unknown) => {
    const o = obj(v), id = clean(o.id, 40)
    return ID.test(id) ? { id, label: clean(o.label, 60) || id } : null
  }
  const glass = pick(c.glass), finish = pick(c.finish)
  if (!glass || !finish) return null
  const choice: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj(c.choice)).slice(0, 20)) {
    const item = clean(v, 80)
    if (ROLE.test(k) && item) choice[k] = item
  }
  const qtyChoice: Record<string, number> = {}
  for (const [k, v] of Object.entries(obj(c.qtyChoice)).slice(0, 20)) {
    if (ROLE.test(k) && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10) qtyChoice[k] = v as number
  }
  const vr = obj(c.variant), variant: LeadConfig['variant'] = {}
  if (MOUNTS.has(String(vr.mount))) variant.mount = vr.mount as LeadConfig['variant']['mount']
  if (vr.profileFrame === 'partial' || vr.profileFrame === 'perimeter') variant.profileFrame = vr.profileFrame
  const pf = typeof c.priceFrom === 'number' && Number.isFinite(c.priceFrom) && c.priceFrom > 0 && c.priceFrom < 10_000_000 ? Math.round(c.priceFrom) : null
  return {
    model: model.code, name: model.name, dims, tier: c.tier === 'premium' ? 'premium' : 'budget',
    glass, finish, choice, qtyChoice, variant, priceFrom: pf,
  }
}

// Одна строка для Telegram и комментария: что клиент собрал и какую цену видел.
export function leadConfigLine(c: LeadConfig): string {
  const size = [c.dims.width, c.dims.width2, c.dims.height].filter(Boolean).join('×')
  return [
    `${c.model} ${c.name}`, `${size} мм`, c.glass.label, c.finish.label,
    c.tier === 'premium' ? 'премиум' : null,
    c.priceFrom ? `видел «от ${rub(c.priceFrom)}»` : null,
  ].filter(Boolean).join(' · ')
}

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
  const config = parseLeadConfig(b.config)
  const configLine = config ? leadConfigLine(config) : ''
  const userComment = clean(b.comment, 600)
  const context = clean(b.context, 300) || clean(b.page, 300)
  const source = clean(b.source, 40) || 'site'

  const utmRaw = (b.utm && typeof b.utm === 'object' ? b.utm : {}) as Record<string, unknown>
  const utm = UTM_KEYS.map(k => [k, clean(utmRaw[k], 100)] as const).filter(([, v]) => v)
  const utmLine = utm.length ? `Метки: ${utm.map(([k, v]) => `${k}=${v}`).join(', ')}` : ''

  const comment = [
    configLine && `Конструктор: ${configLine}`,
    product && `Изделие: ${product}`,
    sizes && `Размеры: ${sizes}`,
    userComment,
    utmLine,
  ].filter(Boolean).join('\n')

  // Telegram читает сообщение как HTML: «&» или «<» в комментарии клиента без
  // экранирования дают 400 «can't parse entities», и заявка до владельца не доходит.
  const message = [
    '🔔 Заявка с сайта',
    name ? `Имя: ${name}` : null,
    `Телефон: ${phone}`,
    configLine ? `Душевая: ${configLine}` : null,
    product ? `Изделие: ${product}` : null,
    sizes ? `Размеры: ${sizes}` : null,
    context ? `Страница: ${context}` : null,
    userComment ? `Комментарий: ${userComment}` : null,
    utmLine || null,
  ].filter((l): l is string => Boolean(l)).map(escapeHtml).join('\n')

  return { kind: 'ok', row: { name, phone, comment, context, source }, message, config }
}
