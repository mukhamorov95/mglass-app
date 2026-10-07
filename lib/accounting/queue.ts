import type { Finding } from './audit'
import type { UpdWaiting } from './updWaiting'

// «Ждут действия» бухгалтера: срез очередей и счётчики вкладок. Источник, который не
// загрузился, — это ошибка словами, а не 0: ноль читается как «делать нечего».

// Окно «к проведению» — одно на карточку, вкладку и проверку: иначе карточка говорит 146,
// а вкладка за месяц показывает 10, и остальное не найти.
export const UNPOSTED_DAYS = 180
export function unpostedFrom(today: string): string {
  return new Date(Date.parse(today + 'T00:00:00Z') - UNPOSTED_DAYS * 86_400_000).toISOString().slice(0, 10)
}

export type Src<T> = { ok: true; value: T } | { ok: false; error: string }

export async function settle<T>(f: () => Promise<T>): Promise<Src<T>> {
  try { return { ok: true, value: await f() } } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type QueueSnapshot = {
  today: string
  bank: Src<{ ip: number; ooo: number; total: number }>
  audit: Src<Finding[]>
  upd: Src<UpdWaiting>
  invoices: Src<{ count: number; sum: number }>
}

export type QueueKey = 'bank' | 'audit' | 'unposted' | 'upd' | 'invoices'

// Число для вкладки/карточки: number — сколько ждёт; null — счётчика нет (не настроено);
// { error } — источник не загрузился.
export type Count = number | null | { error: string }

export function queueCounts(q: QueueSnapshot): Record<QueueKey, Count> {
  const err = (s: { ok: false; error: string }) => ({ error: s.error })
  const findings = q.audit.ok ? q.audit.value : null
  return {
    bank: q.bank.ok ? q.bank.value.total : err(q.bank),
    // «Проверка» — то, что требует действий (срочное и «к работе»); заметки сюда не идут.
    audit: findings ? findings.filter(f => f.severity !== 'low').length : err(q.audit as { ok: false; error: string }),
    // Непроведённые оплаты за полгода — то же число, что в находке «Оплаты не проведены в ОДДС».
    unposted: findings ? (findings.find(f => f.code === 'unposted_payments')?.count ?? 0) : err(q.audit as { ok: false; error: string }),
    upd: !q.upd.ok ? err(q.upd) : q.upd.value.state === 'ok' ? q.upd.value.count : null,
    invoices: q.invoices.ok ? q.invoices.value.count : err(q.invoices),
  }
}

// Сколько всего ждёт действия — для заголовка; источники с ошибкой не складываются.
export function queueTotal(c: Record<QueueKey, Count>): { total: number; failed: number } {
  let total = 0, failed = 0
  for (const v of Object.values(c)) {
    if (typeof v === 'number') total += v
    else if (v && typeof v === 'object') failed++
  }
  return { total, failed }
}
