// Флаги заказа живут в b2b_orders.notes (JSON), рядом с launched_at/deadline_date/
// detail_stages — единый паттерн для order-level данных. Никакой отдельной колонки.

// Производственный контур показывает только заказы с этой даты (решение владельца
// 14.07.2026, уточнено: с 7 июля): всё, что раньше, для цеха считается выполненным.
export const PROD_SINCE = '2026-07-07'

export type MaterialStatus = 'ready' | 'needed'

export function parseNotes(notes: unknown): Record<string, unknown> {
  if (notes == null) return {}
  try {
    const n = typeof notes === 'string' ? JSON.parse(notes) : notes
    return n && typeof n === 'object' ? n as Record<string, unknown> : {}
  } catch { return {} }
}

export function materialStatus(notes: unknown): MaterialStatus | null {
  const s = parseNotes(notes).material_status
  return s === 'ready' || s === 'needed' ? s : null
}

// Статусы material_status, которые значат «заказан у поставщика» — пишет закупщик
// (/purchasing, канбан закупок). Один список на закупку и цех.
// Нарезан = материал уже был: отметка этапа (резка, упаковка, отгрузка) или закрытая задача
// резки цеха — пишут их две разные точки, и одна без другой бывает. Одно правило для закупки,
// главной цеха и «Нужен материал»: иначе цех видит «ждут материал» по уже нарезанному заказу,
// а закупка его же — нет.
export function isOrderCut(stages: Record<string, unknown> | null | undefined, cuttingTaskDone: boolean): boolean {
  const s = stages ?? {}
  return !!(s.cut || s.packaged || s.shipped) || cuttingTaskDone
}

export const MATERIAL_ORDERED: ReadonlySet<string> = new Set(['ordered', 'invoice_received', 'paid', 'shipped'])

export type ShopMaterialState = 'needed' | 'ordered' | 'arrived'
export type ShopMaterial = { state: ShopMaterialState; expected: string | null }
// Последняя заявка цеха на этот заказ/деталь (shop_purchase_requests): need → ordered → arrived.
export type ShopRequestLite = { status: string; expected: string | null }

// Плашка у резчика: нужно / заказан к <дата> / есть. Цех жмёт «Нет мат.» —
// material_status = 'needed' и заявка закупщику. Закупщик пишет то же поле
// («заказан», «принят»), и «нужно» затирается — поэтому ожидание цеха держится на его
// заявке, пока цех сам не нажмёт «Пришёл» (тогда 'ready', и плашки нет).
export function shopMaterial(materialStatus: unknown, req?: ShopRequestLite | null): ShopMaterial | null {
  const s = typeof materialStatus === 'string' ? materialStatus : ''
  if (s === 'needed') {
    if (req?.status === 'arrived') return { state: 'arrived', expected: null }
    if (req?.status === 'ordered') return { state: 'ordered', expected: req.expected ?? null }
    return { state: 'needed', expected: null }
  }
  if (!req) return null
  if (s === 'received' || (req.status === 'arrived' && MATERIAL_ORDERED.has(s))) return { state: 'arrived', expected: null }
  if (MATERIAL_ORDERED.has(s)) return { state: 'ordered', expected: req.expected ?? null }
  return null
}

// '2026-10-09' → '09.10'. Дата в заявке — колонка date, без часового пояса.
const ddmm = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? `${m[3]}.${m[2]}` : null }

export function shopMaterialLabel(m: ShopMaterial): string {
  if (m.state === 'arrived') return '📦 материал есть'
  if (m.state === 'ordered') {
    const d = m.expected ? ddmm(m.expected) : null
    return d ? `🚚 заказан к ${d}` : '🚚 заказан, срок не назван'
  }
  return '🛒 материал нужен'
}

export function isUrgent(notes: unknown): boolean {
  return parseNotes(notes).urgent === true
}

export function deadlineOf(notes: unknown): string | null {
  const d = parseNotes(notes).deadline_date
  return typeof d === 'string' && d ? d : null
}

export function launchedOf(notes: unknown): string | null {
  const n = parseNotes(notes)
  const d = n.launched_at ?? n.work_started_at
  return typeof d === 'string' && d ? d : null
}

// Дней до даты (сегодня = 0, вчера = -1). null если даты нет/битая.
export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

// Приоритет заказа: срочные — в самый верх, затем по возрастанию дней до отгрузки
// (просрочка = отрицательные = выше всех), заказы без срока — в конце.
export function urgencyRank(notes: unknown): number {
  if (isUrgent(notes)) return -1e9
  const d = daysUntil(deadlineOf(notes))
  return d == null ? 1e9 : d
}

// Тон карточки по срочности: red — горит/просрочка/срочно, amber — скоро, none — обычный.
export function urgencyTone(notes: unknown): 'red' | 'amber' | 'none' {
  if (isUrgent(notes)) return 'red'
  const d = daysUntil(deadlineOf(notes))
  if (d == null) return 'none'
  if (d <= 1) return 'red'
  if (d <= 3) return 'amber'
  return 'none'
}

export const RUS_DAYS = (n: number) => {
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return 'дней'
  if (b > 1 && b < 5) return 'дня'
  if (b === 1) return 'день'
  return 'дней'
}

// Человекочитаемо: «осталось 2 дня» / «сегодня» / «просрочка 1 день».
export function daysLeftLabel(deadline?: string | null): string | null {
  const d = daysUntil(deadline)
  if (d == null) return null
  if (d < 0) return `просрочка ${Math.abs(d)} ${RUS_DAYS(d)}`
  if (d === 0) return 'отгрузка сегодня'
  return `осталось ${d} ${RUS_DAYS(d)}`
}
