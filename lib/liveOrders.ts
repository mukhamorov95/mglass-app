import type { SupabaseClient } from '@supabase/supabase-js'

// Единый фильтр к b2b_orders. Раньше каждый экран изобретал свой: из 58 файлов,
// читающих эту таблицу, фильтр стоял в 15. Отсюда все расхождения в цифрах.
//
// В таблице лежат ТРИ разные сущности, и путать их дорого:
//
//   1. Архивные — дубли прогонов импорта. 2 010 строк, 53,2 млн ₽.
//      /b2b-analytics их считал → оборотка 127 млн вместо 74 (+72%).
//
//   2. Просчёты — созданы, но не запущены в работу (launched_at IS NULL).
//      Это ещё не деньги, а намерение. В июле 2026 их было 76 на 4,86 млн ₽ —
//      достаточно, чтобы показать выручку производства 8,5 млн вместо 3,7.
//
//   3. Заказы в работе — то, что цех реально делает и за что придут деньги.
//
// Источник истины по запуску — КОЛОНКА launched_at, не notes.launched_at:
// колонка заполнена у 2 767 строк, JSON — у 840, и нет ни одной строки, где
// JSON есть, а колонки нет. JSON остался для обратной совместимости.

export type OrderMoneyRow = {
  total_after_discount?: number | null
  total_sale_inc_vat?: number | null
}
export type OrderLifecycleRow = {
  archived_at?: string | null
  launched_at?: string | null
}

/** Сумма заказа: после скидки, иначе с НДС. Одно место на весь проект. */
export function orderAmount(o: OrderMoneyRow): number {
  return Number(o.total_after_discount ?? o.total_sale_inc_vat ?? 0) || 0
}

/** Не архивный. База для ЛЮБОГО запроса к b2b_orders. */
export const isLive = (o: OrderLifecycleRow) => o.archived_at == null

/** Запущен в работу — то, что считается выручкой и загрузкой цеха. */
export const isLaunched = (o: OrderLifecycleRow) => o.archived_at == null && o.launched_at != null

/** Просчёт: живой, но ещё не запущен. Воронка, а не выручка. */
export const isQuote = (o: OrderLifecycleRow) => o.archived_at == null && o.launched_at == null

type Q = ReturnType<ReturnType<SupabaseClient['from']>['select']>

/**
 * Не архивные заказы. Начинать с этого везде, где раньше был голый
 * `.from('b2b_orders').select(...)`.
 *
 *   liveOrders(sb, 'id,client_name,total_after_discount')
 */
export function liveOrders(sb: SupabaseClient, columns = '*'): Q {
  return sb.from('b2b_orders').select(columns).is('archived_at', null) as Q
}

/**
 * Заказы В РАБОТЕ — для выручки, оборотки, загрузки цеха, дебиторки.
 * Именно этот фильтр даёт цифру, которую владелец видит в B2B-заказах.
 */
export function launchedOrders(sb: SupabaseClient, columns = '*'): Q {
  // .not() на цепочке PostgrestFilterBuilder раскручивает дженерики так глубоко, что
  // tsc сдаётся («Type instantiation is excessively deep») и next build падает. Сужаем
  // приёмник до минимальной сигнатуры — на рантайме это ровно тот же вызов.
  const q = liveOrders(sb, columns) as unknown as { not(col: string, op: string, val: unknown): unknown }
  return q.not('launched_at', 'is', null) as Q
}

/** Просчёты в работе — воронка продаж, НЕ выручка. */
export function quoteOrders(sb: SupabaseClient, columns = '*'): Q {
  return liveOrders(sb, columns).is('launched_at', null) as Q
}

/**
 * Свести имена юрлиц одного клиента к одному. Список ведётся РУКАМИ: подстрокой
 * такое не склеить («ВРНГЛАЗИЕРС» и «ООО МОНАРХ» текстуально не пересекаются с
 * «MR GLASS»). Без этого крупнейший клиент выглядит как потеря −2,34 млн, хотя
 * растёт на +29%.
 */
export const CLIENT_ALIASES: Record<string, string> = {
  'MR GLASS (ООО ЛЮДИ)': 'MR GLASS',
  'ВРНГЛАЗИЕРС': 'MR GLASS',
  'ООО МОНАРХ': 'MR GLASS',
  'ООО ЛЮДИ': 'MR GLASS',
}

export function canonicalClient(name: string | null | undefined): string {
  const raw = (name ?? '').trim()
  if (!raw) return '—'
  return CLIENT_ALIASES[raw.replace(/\s+/g, ' ').toUpperCase()]
      ?? CLIENT_ALIASES[raw]
      ?? raw
}

/** M GLASS — собственная розница, а не клиент. Исключать из B2B-аналитики. */
export const isOwnRetail = (name: string | null | undefined) => /^m\s*glass$/i.test((name ?? '').trim())
