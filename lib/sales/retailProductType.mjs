// Тип изделия розничной продажи (crm_sales.product_type) — одно правило для всех
// писателей: синк книги «Продажи Мгласс», оплата договора, ручная продажа, бэкфилл.
// .mjs без импортов: модуль грузят и Next, и Node-скрипты (scripts/backfill-retail-product-type.mjs).
//
// Справочник не новый. Коды — те, что уже живут в коде (calculations.product_type,
// contracts.product_kind: mirror / shower / loft / railing / welded); partition, door
// и other — три значения поля amo «Тип изделия» (1304887), у которых кода не было:
// «Межкомнатная перегородка», «Двери», «Другое». Несколько изделий в одной продаже —
// коды через запятую в порядке RETAIL_PRODUCT_TYPES («shower,mirror»).
// Не определилось — null. «other» ставится только явно: amo «Другое» или изделие из
// списка OTHER ниже, никогда как запасной вариант.

export const RETAIL_PRODUCT_TYPES = ['shower', 'mirror', 'loft', 'partition', 'railing', 'door', 'welded', 'other']

export const RETAIL_PRODUCT_LABELS = {
  shower: 'Душевая',
  mirror: 'Зеркало',
  loft: 'Лофт-перегородка',
  partition: 'Межкомнатная перегородка',
  railing: 'Ограждение',
  door: 'Дверь',
  welded: 'Сварная конструкция',
  other: 'Другое',
}

// Поля сделки amo (GET /leads/custom_fields, сверено 14.10.2026).
export const AMO_FIELD_ORDER_NO = 1274755          // «Номер заказа»
export const AMO_FIELD_PRODUCT_TYPE = 1304887      // «Тип изделия» — текущее
export const AMO_FIELD_PRODUCT_OLD = 1279219       // «Изделие» — прежнее

const AMO_ENUM = {
  // «Тип изделия»
  'зеркала': 'mirror',
  'межкомнатная перегородка': 'partition',
  'душевая перегородка': 'shower',
  'ограждения': 'railing',
  'двери': 'door',
  'другое': 'other',
  'лофт': 'loft',
  // «Изделие»
  'душевая': 'shower',
  'зеркало на клей': 'mirror',
  'зеркало с подсветкой': 'mirror',
  'полка': 'other',
  'несколько душевых': 'shower',
}

// calculations.product_type / contracts.product_kind. quick и build — режим
// калькулятора, а не изделие: их состав разбирается по названиям корзины.
const KIND = {
  mirror: 'mirror', shower: 'shower', shower_standard: 'shower', shower_budget: 'shower',
  loft: 'loft', railing: 'railing', welded: 'welded',
}

const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

// Начало слова: \b после русской буквы в JS не работает.
const W = '(?<![а-яa-z])'
const RULES = [
  ['shower', new RegExp(`${W}(душ|шторк|стационар|стац(?![а-я]))`)],
  ['mirror', new RegExp(`${W}(зерк|зерал|зекал)`)],
  ['loft', new RegExp(`${W}лофт`)],
  ['partition', new RegExp(`${W}перегородк`)],
  ['railing', new RegExp(`${W}(огражд|перил)`)],
  ['door', new RegExp(`${W}двер`)],
  ['welded', new RegExp(`${W}сварн`)],
  ['other', new RegExp(`${W}(полк|полоч|стеллаж|фартук|столешниц|панно|козыр|пленк)`)],
]
// Слова, при которых состав продажи не определить: «Стекло М1» — марка стекла или
// модель душевой, «Лестница» — ступени или ограждение, «сауна» — дверь или стенка.
const AMBIGUOUS = new RegExp(`${W}(стекл|саун|лестниц|лесниц|трапец|кнопк|профил|выключат|услуг)`)

const ordered = set => RETAIL_PRODUCT_TYPES.filter(t => set.has(t))

// Правило по тексту: «Душевая и зеркала» → ['shower','mirror']; неоднозначное → [].
export function classifyProductText(text) {
  const t = norm(text).replace(/(душев[а-я]*)\s+перегород[а-я]*/g, '$1')
  if (!t) return { types: [], ambiguous: false }
  if (AMBIGUOUS.test(t)) return { types: [], ambiguous: true }
  const found = new Set()
  for (const [type, re] of RULES) if (re.test(t)) found.add(type)
  return { types: ordered(found), ambiguous: false }
}

export function typesFromAmoEnums(values) {
  const found = new Set()
  for (const v of values ?? []) {
    const code = AMO_ENUM[norm(v)]
    if (code) found.add(code)
  }
  return ordered(found)
}

// Расчёт: тип калькулятора; у quick/build — названия позиций корзины.
export function typesFromCalculation(calc) {
  if (!calc) return []
  const k = KIND[String(calc.product_type ?? '')]
  if (k) return [k]
  const cart = calc.input_data && Array.isArray(calc.input_data.cart) ? calc.input_data.cart : []
  const found = new Set()
  for (const item of cart) {
    const r = classifyProductText(item && typeof item.title === 'string' ? item.title : '')
    if (r.ambiguous) return []
    r.types.forEach(x => found.add(x))
  }
  return ordered(found)
}

export const typesFromKind = kind => (KIND[String(kind ?? '')] ? [KIND[String(kind)]] : [])

export const formatProductTypes = types => (types?.length ? ordered(new Set(types)).join(',') : null)

// Значение колонки → коды. Старые строки книги (до июня 2025) хранят свободный
// текст «Душевая и зеркала» — читаются тем же правилом.
export function parseProductTypes(value) {
  const v = norm(value)
  if (!v) return []
  const parts = v.split(',').map(s => s.trim())
  if (parts.every(p => RETAIL_PRODUCT_TYPES.includes(p))) return ordered(new Set(parts))
  return classifyProductText(value).types
}

// Нормализованный номер заказа: «0826-4 » и «0826–4» — один заказ.
export const normOrderNo = s => String(s ?? '').toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, '')

const fieldValues = (lead, id) => {
  const f = (lead.custom_fields_values ?? []).find(x => Number(x.field_id) === id)
  return (f?.values ?? []).map(v => String(v.value ?? '')).filter(Boolean)
}

// Сделка amo относится к заказу, если её поле «Номер заказа» равно номеру; поля
// нет — если название начинается с номера («0713-3 (доп зеркало)»), но не с более
// длинного («0826-4-1» — другой заказ, чем «0826-4»).
export function leadMatchesOrder(lead, orderNo) {
  const key = normOrderNo(orderNo)
  if (!key) return false
  const field = fieldValues(lead, AMO_FIELD_ORDER_NO)
  if (field.length) return field.some(v => normOrderNo(v) === key)
  const name = normOrderNo(lead.name)
  if (!name.startsWith(key)) return false
  return !/^(\d|-\d)/.test(name.slice(key.length))
}

// Тип по сделкам amo одного заказа: сначала поля «Тип изделия» / «Изделие» всех
// сделок заказа, если их нет ни у одной — правило по названию сделки.
export function typesFromAmoLeads(leads, orderNo) {
  const mine = (leads ?? []).filter(l => leadMatchesOrder(l, orderNo))
  const field = new Set()
  for (const l of mine) {
    let t = typesFromAmoEnums(fieldValues(l, AMO_FIELD_PRODUCT_TYPE))
    if (!t.length) t = typesFromAmoEnums(fieldValues(l, AMO_FIELD_PRODUCT_OLD))
    t.forEach(x => field.add(x))
  }
  if (field.size) return { types: ordered(field), source: 'amo_field', leadIds: mine.map(l => l.id) }
  const named = new Set()
  for (const l of mine) {
    const r = classifyProductText(l.name)
    if (r.ambiguous) return { types: [], source: null, leadIds: mine.map(l => l.id), ambiguous: true }
    r.types.forEach(x => named.add(x))
  }
  if (named.size) return { types: ordered(named), source: 'amo_name', leadIds: mine.map(l => l.id) }
  return { types: [], source: null, leadIds: mine.map(l => l.id) }
}

// Приоритет источников: связанный расчёт → сделка (договор, затем amo) → текст.
// dealKinds — product_kind договоров заказа (у одного номера их бывает два: душевая и зеркала).
export function pickRetailProductType({ calculation, dealKinds, amo, text } = {}) {
  const calc = typesFromCalculation(calculation)
  if (calc.length) return { value: formatProductTypes(calc), source: 'calculation' }
  const deal = (dealKinds ?? []).flatMap(typesFromKind)
  if (deal.length) return { value: formatProductTypes(deal), source: 'deal' }
  if (amo?.types?.length) return { value: formatProductTypes(amo.types), source: amo.source }
  const t = classifyProductText(text)
  if (t.types.length) return { value: formatProductTypes(t.types), source: 'text' }
  return { value: null, source: null }
}

// Сделки amo по номерам заказов: GET /leads?query=<номер>, только чтение. get —
// GET-обёртка вызывающего (amoGet в приложении, свой fetch в скрипте).
export async function amoProductTypes(orderNos, get) {
  const out = new Map()
  for (const no of [...new Set(orderNos.filter(Boolean))]) {
    const j = await get('/leads', { query: String(no).trim(), limit: '50' })
    const leads = j?._embedded?.leads ?? []
    out.set(no, typesFromAmoLeads(leads, no))
  }
  return out
}
