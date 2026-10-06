// «Всё ли работает» — живые проверки AI Control Center и крона тревоги. Не «таблица
// существует», а то, что ломается на деле: деньги на AI, утренние синки книг, AmoCRM,
// очередь Авито. 06.10 кончились деньги на Anthropic: не работали все AI-функции, а
// старый Health Check показывал «25 ок». Только сервер: здесь ключи.

import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { amoGet } from '@/lib/amocrm'
import { MONTAGE_BOOK_ID } from '@/lib/sales/montageBook'
import { CRON_JOBS } from '@/lib/cronRuns'

export type LiveStatus = 'ok' | 'warn' | 'fail'
export type LiveCheck = { id: string; title: string; status: LiveStatus; detail: string; action?: string }
type Verdict = Omit<LiveCheck, 'id' | 'title'>

export const AI_FEATURES = 'AI-чат менеджера, распознавание дизайн-проектов, чертежей, замеров и КП, генерация КП, Telegram-бот, агенты-аналитики, рекомендации AI Control Center'

// Ошибка Anthropic → что сломалось и что делать. Сырой JSON на экране («credit
// balance is too low») владелец прочитать не обязан.
export function classifyAnthropicError(status: number | undefined, message: string): Verdict {
  const m = message ?? ''
  if (/credit balance is too low|billing/i.test(m) || status === 402) {
    return {
      status: 'fail',
      detail: `На счёте Anthropic API нет денег — не работают все AI-функции: ${AI_FEATURES}.`,
      action: 'Пополнить счёт: console.anthropic.com → Settings → Billing → Buy credits; там же включить автопополнение (Auto reload).',
    }
  }
  if (status === 401 || /authentication_error|invalid x-api-key/i.test(m)) {
    return {
      status: 'fail',
      detail: 'Ключ ANTHROPIC_API_KEY не принят — AI-функции не работают.',
      action: 'Выпустить ключ в console.anthropic.com → API keys и заменить ANTHROPIC_API_KEY в настройках прода Vercel.',
    }
  }
  if (status === 403 || /permission_error/i.test(m)) {
    return {
      status: 'fail',
      detail: 'Ключу Anthropic запрещён доступ (permission_error) — AI-функции не работают.',
      action: 'Проверить в console.anthropic.com, к какой организации и рабочему пространству привязан ключ.',
    }
  }
  if (status === 429 || /rate_limit/i.test(m)) {
    return {
      status: 'warn',
      detail: 'Anthropic: упёрлись в лимит запросов — часть AI-запросов отклоняется.',
      action: 'Если повторяется — поднять лимит: console.anthropic.com → Settings → Limits.',
    }
  }
  if (status === 529 || (status != null && status >= 500) || /overloaded/i.test(m)) {
    return {
      status: 'warn',
      detail: 'Сбой на стороне Anthropic — AI отвечает с ошибками.',
      action: 'Проверить status.claude.com; обычно проходит само.',
    }
  }
  return { status: 'fail', detail: `Anthropic ответил ошибкой${status ? ` ${status}` : ''}: ${m.slice(0, 200)}` }
}

// Текст ошибки AI для экрана: что сломалось и что делать, одной строкой.
export function aiErrorText(e: unknown): string {
  const status = e instanceof Anthropic.APIError ? e.status : undefined
  const message = e instanceof Error ? e.message : String(e)
  if (status == null && !/credit balance|authentication_error|permission_error|rate_limit|overloaded/i.test(message)) return message
  const v = classifyAnthropicError(status, message)
  return v.action ? `${v.detail} ${v.action}` : v.detail
}

const PROBE_MODEL = 'claude-haiku-4-5-20251001'

export async function checkAnthropic(): Promise<Verdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { status: 'fail', detail: 'ANTHROPIC_API_KEY не задан — AI-функции не работают.', action: 'Задать ключ в настройках прода Vercel.' }
  try {
    // Один токен самой дешёвой модели: проверяем не модель, а что счёт и ключ живы.
    await new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 }).messages.create({
      model: PROBE_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }],
    })
    return { status: 'ok', detail: 'Отвечает' }
  } catch (e) {
    return classifyAnthropicError(e instanceof Anthropic.APIError ? e.status : undefined, e instanceof Error ? e.message : String(e))
  }
}

const mskTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })

// Синк книги идёт раз в сутки: свежее суток с запасом — норма, до двух суток —
// сегодняшний не прошёл, дольше — синк стоит.
export function freshness(lastIso: string | null, now: Date, opts: { what: string; schedule: string; action: string }): Verdict {
  if (!lastIso) return { status: 'fail', detail: `${opts.what}: ни одного обновления — синк ни разу не прошёл.`, action: opts.action }
  const hours = (now.getTime() - Date.parse(lastIso)) / 3_600_000
  if (hours <= 26) return { status: 'ok', detail: `Обновлено ${mskTime(lastIso)} МСК` }
  const days = Math.floor(hours / 24)
  return {
    status: hours <= 50 ? 'warn' : 'fail',
    detail: `${opts.what}: последнее обновление ${mskTime(lastIso)} МСК (${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'} назад), синк ${opts.schedule} не прошёл.`,
    action: opts.action,
  }
}

async function lastTimestamp(sb: SupabaseClient, table: string, column: string): Promise<string | null> {
  const { data, error } = await sb.from(table).select(column).order(column, { ascending: false }).limit(1)
  if (error) throw new Error(`${table}: ${error.message}`)
  const row = (data?.[0] ?? null) as unknown as Record<string, string> | null
  return row?.[column] ?? null
}

async function checkMontageBook(): Promise<Verdict> {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${MONTAGE_BOOK_ID}/htmlview`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  if (r.ok) return { status: 'ok', detail: 'Открывается по ссылке' }
  return {
    status: 'fail',
    detail: `Книга «Монтажи» не открывается по ссылке (HTTP ${r.status}) — сверка монтажников на «Марже» не работает.`,
    action: 'Проверить в книге доступ «Все, у кого есть ссылка — читатель».',
  }
}

async function checkAmo(): Promise<Verdict> {
  try {
    await amoGet('/account')
    return { status: 'ok', detail: 'Токен действует' }
  } catch (e) {
    return {
      status: 'fail',
      detail: `AmoCRM не отвечает: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)} — воронка, звонки и распределение заявок без данных.`,
      action: 'Проверить токен AmoCRM (AMO_ACCESS_TOKEN / AMO_REFRESH_TOKEN) в настройках прода Vercel.',
    }
  }
}

async function checkAvitoQueue(sb: SupabaseClient, now: Date): Promise<Verdict> {
  const day = new Date(now.getTime() - 86_400_000).toISOString()
  const { count, error } = await sb.from('message_queue').select('id', { count: 'exact', head: true })
    .eq('status', 'failed').gte('updated_at', day)
  if (error) throw new Error(`message_queue: ${error.message}`)
  if (!count) return { status: 'ok', detail: 'Ошибок за сутки нет' }
  return {
    status: 'warn',
    detail: `${count} сообщений Авито за сутки не дошли до AmoCRM.`,
    action: 'Открыть «Avito / AMO Monitor» (/admin/integrations) → «Повторить».',
  }
}

export type CronRunRow = {
  job: string; last_started_at: string | null; last_ok_at: string | null
  last_error: string | null; last_error_at: string | null
}

const UNFINISHED_MS = 15 * 60_000

// Журнал кронов → строки «Всё ли работает». Всё в порядке — одна сводная строка,
// иначе по строке на каждый крон с бедой: упал, давно не проходил, не завершился.
export function cronVerdicts(rows: CronRunRow[], now: Date, jobs = CRON_JOBS): LiveCheck[] {
  const by = new Map(rows.map(r => [r.job, r]))
  const at = (iso: string | null) => (iso ? Date.parse(iso) : 0)
  const bad: LiveCheck[] = []
  let fine = 0, waiting = 0
  for (const j of jobs) {
    const r = by.get(j.job)
    const okAt = at(r?.last_ok_at ?? null), errAt = at(r?.last_error_at ?? null), startAt = at(r?.last_started_at ?? null)
    const id = `cron_${j.job}`, title = `Крон: ${j.title}`
    const logs = `Подробности — логи Vercel по /api/cron/${j.job}.`
    if (!okAt && !errAt && !startAt) { waiting++; continue }
    if (errAt > okAt) {
      bad.push({ id, title, status: 'fail', detail: `Запуск ${mskTime(r!.last_error_at!)} МСК упал: ${(r!.last_error ?? '').slice(0, 300)}`, action: logs })
    } else if (okAt && now.getTime() - okAt > j.maxHours * 3_600_000) {
      bad.push({ id, title, status: 'fail', detail: `Последний успешный запуск ${mskTime(r!.last_ok_at!)} МСК — больше ${j.maxHours} ч назад, по расписанию должен был пройти.`, action: logs })
    } else if (startAt > Math.max(okAt, errAt) && now.getTime() - startAt > UNFINISHED_MS) {
      bad.push({ id, title, status: 'warn', detail: `Запущен ${mskTime(r!.last_started_at!)} МСК и не завершился — вероятно, Vercel оборвал его по времени.`, action: logs })
    } else if (okAt) fine++
    else waiting++
  }
  if (bad.length) return bad
  return [{
    id: 'crons', title: 'Кроны', status: 'ok',
    detail: fine
      ? `${fine} из ${jobs.length} проходят по расписанию${waiting ? `, ${waiting} ещё не запускались с включения журнала` : ''}`
      : 'Журнал включён, ждём первых запусков',
  }]
}

async function checkCrons(sb: SupabaseClient, now: Date): Promise<LiveCheck[]> {
  const { data, error } = await sb.from('cron_runs').select('job, last_started_at, last_ok_at, last_error, last_error_at')
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message)) {
      return [{
        id: 'crons', title: 'Кроны', status: 'warn',
        detail: 'Журнал кронов не включён — не видно, прошли ли утренние синки, бэкап и распределение заявок.',
        action: 'Выполнить SQL из supabase/migrations/20261006_cron_runs.sql: Supabase → SQL Editor → вставить → Run.',
      }]
    }
    throw new Error(`cron_runs: ${error.message}`)
  }
  return cronVerdicts((data ?? []) as CronRunRow[], now)
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`не ответила за ${ms / 1000} с`)), ms))])

export async function runLiveChecks(sb: SupabaseClient, now = new Date()): Promise<LiveCheck[]> {
  const defs: { id: string; title: string; run: () => Promise<Verdict> }[] = [
    { id: 'ai_anthropic', title: 'AI (Claude)', run: checkAnthropic },
    {
      id: 'book_mgmt', title: 'Управленческая книга → «Показатели менеджеров»',
      run: async () => freshness(await lastTimestamp(sb, 'manager_stats_daily', 'updated_at'), now, {
        what: '«Аналитика дохода»', schedule: 'в 8:05 МСК',
        action: 'Проверить, что лист «Аналитика дохода» открыт по ссылке; утренний отчёт синка приходит в Telegram.',
      }),
    },
    {
      id: 'book_margin', title: 'Книга «Маржа» → экран «Маржа»',
      run: async () => freshness(await lastTimestamp(sb, 'margin_book_rows', 'synced_at'), now, {
        what: '«Маржа»', schedule: 'в 8:10 МСК',
        action: 'Проверить, что книга «Маржа» открыта по ссылке; утренний отчёт синка приходит в Telegram.',
      }),
    },
    { id: 'book_montage', title: 'Книга «Монтажи»', run: checkMontageBook },
    { id: 'amocrm', title: 'AmoCRM', run: checkAmo },
    { id: 'avito_queue', title: 'Авито → AmoCRM', run: () => checkAvitoQueue(sb, now) },
  ]
  const failed = (id: string, title: string, e: unknown): LiveCheck =>
    ({ id, title, status: 'warn', detail: `Проверка не выполнилась: ${e instanceof Error ? e.message : String(e)}` })
  const [single, crons] = await Promise.all([
    Promise.all(defs.map(async d => {
      try {
        return { id: d.id, title: d.title, ...(await withTimeout(d.run(), 20_000)) }
      } catch (e) {
        return failed(d.id, d.title, e)
      }
    })),
    withTimeout(checkCrons(sb, now), 20_000).catch(e => [failed('crons', 'Кроны', e)]),
  ])
  return [...single, ...crons]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Сообщение в Telegram — только когда есть красное: жёлтое ждёт открытия страницы.
export function alertText(checks: LiveCheck[], pageUrl: string): string | null {
  const fail = checks.filter(c => c.status === 'fail')
  if (!fail.length) return null
  const warn = checks.filter(c => c.status === 'warn')
  const line = (c: LiveCheck) => `• <b>${esc(c.title)}</b>: ${esc(c.detail)}${c.action ? `\n  → ${esc(c.action)}` : ''}`
  return [
    `🔴 <b>Не работает: ${fail.length}</b>`,
    ...fail.map(line),
    ...(warn.length ? ['', `⚠️ <b>Требует внимания: ${warn.length}</b>`, ...warn.map(line)] : []),
    '',
    `Подробно: ${pageUrl}`,
  ].join('\n')
}
