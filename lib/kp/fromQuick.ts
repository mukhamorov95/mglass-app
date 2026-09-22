// Снимок «Быстрого расчёта» → содержимое КП.
//
// Одна функция на два входа: кнопка «Сформировать КП» в калькуляторе (живые поля)
// и карточка сохранённого расчёта (снимок из истории). Раньше сборка жила только
// внутри страницы калькулятора — сохранённый расчёт в КП было не превратить,
// и менеджер, нажавший «Сохранить», оставался без КП.

export type QuickCartItem = {
  title: string; productPrice: number; installTotal: number
  sections: number; perSection: number; delivery: number; lift: number; total: number
}

export type QuickSnapshot = {
  cart?: QuickCartItem[]
  designer?: number
  measureDiscount?: string | number
  extraMode?: 'pct' | 'sum'
  extraVal?: string | number
  clientName?: string
  clientPhone?: string
}

export type KpItem = { name: string; qty?: number; price?: number; sum: number }
export type KpPrefill = {
  title: string
  items: KpItem[]
  subtotal: number
  total: number
  client_name?: string
  client_phone?: string
}

const num = (v: unknown): number => {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  return isFinite(n) ? n : 0
}

// Дизайнеру закладываем его % + 5% компании: выбрали 10% → надбавка 15%.
export const designerMarkupPct = (designer: unknown): number => {
  const d = num(designer)
  return d > 0 ? d + 5 : 0
}

// Итоги быстрого расчёта: надбавка дизайнера, скидка замера, доп. скидка.
export function quickTotals(s: QuickSnapshot) {
  const cart = Array.isArray(s.cart) ? s.cart : []
  const grand = cart.reduce((acc, c) => acc + num(c.total), 0)
  const pct = designerMarkupPct(s.designer)
  const withDesigner = grand + Math.round(grand * pct / 100)
  const measureDisc = Math.min(withDesigner, Math.max(0, num(s.measureDiscount)))
  const afterMeasure = withDesigner - measureDisc
  const extraDisc = s.extraMode === 'sum'
    ? Math.min(afterMeasure, Math.max(0, num(s.extraVal)))
    : Math.round(afterMeasure * Math.max(0, num(s.extraVal)) / 100)
  return { grand, pct, withDesigner, measureDisc, extraDisc, finalGrand: Math.max(0, afterMeasure - extraDisc) }
}

// Клиент видит цены уже с надбавкой дизайнера — она размазана по изделиям,
// отдельной строкой в КП не значится.
export function kpFromQuick(s: QuickSnapshot): KpPrefill | null {
  const cart = Array.isArray(s.cart) ? s.cart.filter(Boolean) : []
  if (!cart.length) return null
  const t = quickTotals(s)
  const k = 1 + t.pct / 100
  const multi = cart.length > 1
  const items: KpItem[] = []
  for (const it of cart) {
    const suf = multi ? ` — ${it.title}` : ''
    const price = Math.round(num(it.productPrice) * k)
    items.push({ name: it.title || 'Изделие', qty: 1, price, sum: price })
    if (num(it.installTotal) > 0) {
      items.push({ name: `Монтаж${suf}`, qty: num(it.sections) || 1, price: Math.round(num(it.perSection) * k), sum: Math.round(num(it.installTotal) * k) })
    }
    if (num(it.delivery) > 0) items.push({ name: `Доставка${suf}`, qty: 1, sum: Math.round(num(it.delivery) * k) })
    if (num(it.lift) > 0) items.push({ name: `Подъём${suf}`, qty: 1, sum: Math.round(num(it.lift) * k) })
  }
  // Строки округляются каждая сама по себе, поэтому их сумма может разойтись с
  // итогом на рубль-другой. В КП клиенту это недопустимо: остаток кладём в самую
  // крупную строку — она одна, и рубль в ней незаметен.
  fitToSubtotal(items, t.withDesigner)
  return {
    title: (cart.length === 1 ? cart[0].title || 'Изделие' : 'Коммерческое предложение').toUpperCase(),
    items,
    subtotal: t.withDesigner,
    total: t.finalGrand,
    client_name: s.clientName?.trim() || undefined,
    client_phone: s.clientPhone?.trim() || undefined,
  }
}

// КП из карточки сделки. Расчёт товарного калькулятора — одна строка (его состав
// живёт в самом расчёте), быстрый расчёт раскрывается по изделиям: иначе клиент
// получает КП со строкой «Быстрый расчёт» на всю сумму.
export type DealCalc = { product_type: string; final_price: number; label: string; input_data?: Record<string, unknown> }

export function kpItemsFromCalcs(calcs: DealCalc[]): { items: KpItem[]; total: number } {
  const items: KpItem[] = []
  for (const c of calcs) {
    const price = Math.round(Number(c.final_price) || 0)
    const kp = c.product_type === 'quick' ? kpFromQuick((c.input_data ?? {}) as QuickSnapshot) : null
    if (!kp) { items.push({ name: c.label, qty: 1, price, sum: price }); continue }
    items.push(...kp.items)
    // Главный здесь — итог расчёта, он же на карточке сделки: строки обязаны дать
    // именно его. Разницу (скидка, правка цены руками) показываем строкой, а не
    // прячем в изделия.
    const target = price > 0 ? price : kp.total
    const diff = target - kp.subtotal
    if (diff) items.push({ name: diff < 0 ? 'Скидка' : 'Корректировка', qty: 1, sum: diff })
  }
  return { items, total: items.reduce((s, i) => s + i.sum, 0) }
}

function fitToSubtotal(items: KpItem[], subtotal: number) {
  const sum = items.reduce((acc, i) => acc + i.sum, 0)
  const diff = subtotal - sum
  if (!diff || !items.length) return
  let big = 0
  for (let i = 1; i < items.length; i++) if (items[i].sum > items[big].sum) big = i
  items[big].sum += diff
  if (items[big].qty === 1 && items[big].price != null) items[big].price = items[big].sum
}
