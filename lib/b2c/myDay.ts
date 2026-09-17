import { mskDayKey } from '@/lib/time'

// Отбор «Моего дня» вынесен из страницы: время нельзя брать в теле рендера
// (результат становится нестабильным при повторной отрисовке), а правила отбора
// без тестов расходятся с тем, что написано в подписи блока.

export type MyDayDeal = {
  id: number; client_name: string | null; phone: string | null; address: string | null
  updated_at: string; next_contact_at: string | null; manager_id?: string | null
}
export type MyDayMeasure = {
  id: number; deal_id: number | null; client_name: string | null; address: string | null
  scheduled_at: string | null; status: string | null
  manager_id?: string | null; manager_name?: string | null; scope?: string | null
  phone?: string | null; created_at?: string | null
}

const DAY = 86_400_000
export const STALE_DAYS = 7
// Сколько зависших показываем списком. Остальные не прячем — под списком стоит
// «и ещё N», иначе счётчик врёт (грабли группы A аудита итогов).
export const STALE_SHOWN = 12

export function daysSince(iso: string | null | undefined, now: number = Date.now()): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now - t) / DAY))
}

// «5 дней», «1 день», «21 день»
export function plurDays(n: number): string {
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return `${n} дней`
  if (b === 1) return `${n} день`
  if (b >= 2 && b <= 4) return `${n} дня`
  return `${n} дней`
}

// «сегодня» вместо «лежит 0 дней» — ноль в подписи выглядит ошибкой, а не свежестью.
export function lyingFor(iso: string | null | undefined, now: number = Date.now()): string {
  const d = daysSince(iso, now)
  return d === 0 ? 'сегодня' : `лежит ${plurDays(d)}`
}

export function pickUrgent(deals: MyDayDeal[], measures: MyDayMeasure[], now: number = Date.now()) {
  const today = mskDayKey(new Date(now))
  const tomorrow = mskDayKey(new Date(now + DAY))
  const todayISO = mskDayKey(new Date(now))

  // Сделка без движения дольше недели: не «плохо», а «вспомни». Те, кому уже
  // назначен контакт, сюда не попадают — они выше и с конкретной датой.
  const staleAll = deals
    .filter(d => !d.next_contact_at && now - new Date(d.updated_at).getTime() > STALE_DAYS * DAY)
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))

  const unscheduled = measures
    .filter(m => !m.scheduled_at)
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))

  return {
    // Обещали связаться сегодня или раньше — это сильнее «давно не трогали»:
    // дату назначил сам менеджер, и она уже наступила.
    promised: deals
      .filter(d => !!d.next_contact_at && d.next_contact_at <= todayISO)
      .sort((a, b) => (a.next_contact_at ?? '').localeCompare(b.next_contact_at ?? '')),
    // Замер сегодня или завтра — самое срочное: человек уже выехал или выедет.
    soon: measures.filter(m => {
      if (!m.scheduled_at) return false
      const k = mskDayKey(new Date(m.scheduled_at))
      return k === today || k === tomorrow
    }),
    // Заявка без даты — её никто не назначил, и она молча стоит. Старые сверху:
    // заявка июля важнее вчерашней.
    unscheduled,
    stale: staleAll.slice(0, STALE_SHOWN),
    staleTotal: staleAll.length,
  }
}

// ─── Расчёты без клиента ─────────────────────────────────────────────────────

export type OrphanCalc = {
  id: number
  created_at: string
  product_type: string | null
  client_name: string | null
  client_phone: string | null
  final_price: number | string | null
  client_text: string | null
  created_by?: string | null
  created_by_name?: string | null
  archived_at?: string | null
}

const PRODUCT_LABELS: Record<string, string> = {
  quick: 'Быстрый расчёт',
  build: 'Расчёт',
  mirror: 'Зеркало',
  loft: 'Лофт-перегородка',
  shower: 'Душевая',
  shower_standard: 'Душевая',
  shower_budget: 'Душевая (бюджет)',
  railing: 'Ограждение',
}

export function productLabel(t: string | null | undefined): string {
  if (!t) return 'Расчёт'
  return PRODUCT_LABELS[t] ?? t
}

// Заголовок строки: первая осмысленная строка client_text. У зеркал и лофта там
// многострочная спецификация, и одной строкой видно только «Зеркало 4 мм» —
// остальное отдаёт orphanSpec для раскрытия.
export function orphanTitle(o: OrphanCalc): string {
  const first = (o.client_text ?? '').split('\n').map(s => s.trim()).find(Boolean)
  if (first) return first
  if (o.client_name) return o.client_name
  return `${productLabel(o.product_type)} #${o.id}`
}

// Полный состав расчёта построчно — то, «при каких обстоятельствах он сделан».
export function orphanSpec(o: OrphanCalc): string[] {
  const all = (o.client_text ?? '').split('\n').map(s => s.trim()).filter(Boolean)
  return all.slice(1)
}

export function orphanSum(o: OrphanCalc): number | null {
  if (o.final_price == null) return null
  const n = Number(o.final_price)
  return Number.isFinite(n) ? n : null
}

// Итог списка раскрывается: сколько расчётов и на какую сумму.
export function orphanTotal(items: OrphanCalc[]): { count: number; sum: number; withSum: number } {
  let sum = 0, withSum = 0
  for (const o of items) {
    const v = orphanSum(o)
    if (v != null) { sum += v; withSum++ }
  }
  return { count: items.length, sum, withSum }
}
