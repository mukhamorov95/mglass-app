// Журнал запусков кронов: по строке на крон — последний старт, успех, ошибка.
// Без него «утренний синк не прошёл» было видно только по отсутствию сообщения в
// Telegram. Запись журнала никогда не роняет сам крон: таблицу создаёт владелец
// (supabase/migrations/20261006_cron_runs.sql), до этого запись просто не ложится.

import { createServiceClient } from '@/lib/supabase-service'

// Ключевые кроны и как часто они обязаны успешно проходить (часы, с запасом на выходные).
export const CRON_JOBS: { job: string; title: string; maxHours: number }[] = [
  { job: 'sales-sheet-sync', title: 'Синк «Продажи M-Glass» (8:00)', maxHours: 26 },
  { job: 'manager-stats-sync', title: 'Синк «Аналитика дохода» (8:05)', maxHours: 26 },
  { job: 'margin-book-sync', title: 'Синк «Маржа» (8:10)', maxHours: 26 },
  { job: 'sales-ledger-check', title: 'Сверка реестра продаж (13:00, пн–сб)', maxHours: 50 },
  { job: 'payments-reconcile', title: 'Сверка оплат (6:30)', maxHours: 26 },
  { job: 'money-integrity', title: 'Целостность денег (7:15)', maxHours: 26 },
  { job: 'backup', title: 'Бэкап (6:00)', maxHours: 26 },
  { job: 'morning-briefing', title: 'Утренняя сводка (7:00)', maxHours: 26 },
  { job: 'lead-distribution', title: 'Распределение заявок (каждые 5 мин)', maxHours: 1 },
  { job: 'process-queue', title: 'Очередь Авито → AmoCRM (10:00)', maxHours: 26 },
  { job: 'ai-recommendations', title: 'AI-рекомендации (9:00)', maxHours: 26 },
  { job: 'live-health', title: 'Проверка «Всё ли работает» (9:30, 14:30)', maxHours: 26 },
]

type Row = { job: string; last_started_at?: string; last_ok_at?: string; last_error?: string | null; last_error_at?: string; last_ms?: number; updated_at: string }

async function save(row: Row) {
  try { await createServiceClient().from('cron_runs').upsert(row, { onConflict: 'job' }) } catch {}
}

export async function withCronRun(job: string, req: Request, run: () => Promise<Response>): Promise<Response> {
  // Вызов без секрета — не запуск крона: в журнал не пишем, маршрут сам ответит 401/403.
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return run()
  const started = new Date().toISOString()
  // Старт отдельно: если Vercel убьёт крон по времени, старт окажется новее успеха.
  await save({ job, last_started_at: started, updated_at: started })
  const t0 = Date.now()
  let res: Response
  try {
    res = await run()
  } catch (e) {
    const now = new Date().toISOString()
    await save({ job, last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500), last_error_at: now, last_ms: Date.now() - t0, updated_at: now })
    throw e
  }
  let error: string | null = null
  if (!res.ok) error = `HTTP ${res.status}: ${(await res.clone().text().catch(() => '')).slice(0, 400)}`
  else {
    const body = await res.clone().json().catch(() => null) as { ok?: boolean; error?: unknown } | null
    if (body && body.ok === false) error = String(body.error ?? 'ok: false').slice(0, 500)
  }
  const now = new Date().toISOString()
  await save(error
    ? { job, last_error: error, last_error_at: now, last_ms: Date.now() - t0, updated_at: now }
    : { job, last_ok_at: now, last_ms: Date.now() - t0, updated_at: now })
  return res
}
