import { fmtTime, mskDay } from '@/lib/amoActivity'
import { escapeHtml } from '@/lib/security/accessAudit'

// Итог дня по заявке: факты из amo и журнала АТС → примечание. Только правила, без запросов —
// сбор в lib/dayNotes/collect.ts. Формулировки — о следе в amo, а не о человеке: звонок с
// личного телефона и переписку мимо Wazzup amo не видит, «нет в amo» ≠ «не связался».

export const FAST_MIN = 15
export const SLOW_MIN = 60

export type LeadDayFacts = {
  leadId: number
  name: string
  url: string
  responsibleId: number
  responsible: string
  createdAt: number
  daytime: boolean
  stageAtStart: string | null
  stageNow: string
  closed: 'won' | 'lost' | null
  firstTouchAt: number | null
  waitingSince: number | null
  // пропущенные, на которые АТС не видит перезвона; after — касание в amo после звонка
  missed: { at: number; attempts: number; after: { at: number; what: string } | null }[]
  task: { text: string; dueAt: number } | null
}

export type DayNote = { leadId: number; good: string[]; bad: string[]; attention: string[]; tomorrow: string[]; text: string }

const dm = (ts: number) => { const [, m, d] = mskDay(ts).split('-'); return `${d}.${m}` }
const when = (ts: number, now: number) => (mskDay(ts) === mskDay(now) ? fmtTime(ts) : `${dm(ts)} ${fmtTime(ts)}`)

export function fmtDur(min: number): string {
  if (min < 60) return `${Math.max(min, 0)} мин`
  const h = Math.floor(min / 60), m = min % 60
  if (h >= 24) return `${Math.floor(h / 24)} дн ${h % 24} ч`
  return m ? `${h} ч ${m} мин` : `${h} ч`
}

const minutes = (a: number, b: number) => Math.round((b - a) / 60)
const quote = (s: string) => `«${s.replace(/\s+/g, ' ').trim().slice(0, 80)}»`

export function dayNote(f: LeadDayFacts, now: number): DayNote {
  const good: string[] = [], bad: string[] = [], attention: string[] = [], tomorrow: string[] = []
  const head = [`Пришла ${when(f.createdAt, now)}${f.daytime ? '' : ' — вне рабочего времени'}`, `сейчас: ${f.stageNow}`]

  if (f.firstTouchAt === null) {
    if (!f.closed) {
      bad.push('В amo нет ни сообщения, ни звонка клиенту')
      tomorrow.push('связаться с клиентом с утра')
    }
  } else {
    const min = minutes(f.createdAt, f.firstTouchAt)
    const line = `Первое сообщение или звонок — ${when(f.firstTouchAt, now)}, через ${fmtDur(min)}`
    if (!f.daytime || min <= FAST_MIN) good.push(line)
    else if (min > SLOW_MIN) bad.push(line)
    else head.push(line.charAt(0).toLowerCase() + line.slice(1))
  }

  if (f.waitingSince !== null) {
    bad.push(`Клиент написал в ${when(f.waitingSince, now)} и ждёт ответа`)
    tomorrow.push('первым делом ответить в чате')
  }

  for (const m of f.missed) {
    const tries = m.attempts > 1 ? ` (${m.attempts} раза)` : ''
    if (m.after === null) {
      bad.push(`Пропущенный звонок в ${when(m.at, now)}${tries} — не перезвонили`)
      tomorrow.push('перезвонить')
    } else {
      attention.push(`Пропущенный звонок в ${when(m.at, now)}${tries} — не перезвонили, после него было ${m.after.what} в ${when(m.after.at, now)}`)
    }
  }

  if (f.closed === 'won') good.push('Сделка реализована')
  else if (!f.closed && f.stageAtStart && f.stageAtStart !== f.stageNow) good.push(`Этап: ${f.stageAtStart} → ${f.stageNow}`)

  if (!f.closed) {
    if (!f.task) {
      attention.push('Нет задачи со следующим шагом')
      tomorrow.push('поставить задачу со следующим шагом')
    } else if (f.task.dueAt < now) {
      bad.push(`Задача${f.task.text.trim() ? ` ${quote(f.task.text)}` : ''} просрочена, срок ${when(f.task.dueAt, now)}`)
      tomorrow.push('закрыть или перенести просроченную задачу')
    } else {
      good.push(f.task.text.trim()
        ? `Следующий шаг: ${quote(f.task.text)} — ${when(f.task.dueAt, now)}`
        : `Следующий шаг: задача на ${when(f.task.dueAt, now)}`)
    }
  }

  const todo = [...new Set(tomorrow)]
  const lines = [
    `Итог дня ${dm(now)} — разбор автоматически`,
    head.join(' · '),
    ...good.map(s => `✅ ${s}`),
    ...bad.map(s => `⚠️ ${s}`),
    ...attention.map(s => `👀 ${s}`),
    todo.length ? `➡️ Завтра: ${todo.join('; ')}` : '➡️ Завтра: по плану, замечаний нет',
  ]
  return { leadId: f.leadId, good, bad, attention, tomorrow: todo, text: lines.join('\n') }
}

export type DayRun = {
  from: number
  now: number
  mode: 'dry' | 'write'
  facts: LeadDayFacts[]
  notes: DayNote[]
  noDealMissed: number
  written: number
}

const LIST_LIMIT = 15

// Итог по команде владельцу в Telegram (parse_mode: HTML — всё из amo экранируется)
export function teamSummary(run: DayRun): string {
  const { facts, notes } = run
  const byLead = new Map(notes.map(n => [n.leadId, n]))
  const perPerson = new Map<string, number>()
  for (const f of facts) perPerson.set(f.responsible, (perPerson.get(f.responsible) ?? 0) + 1)
  const people = [...perPerson].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${escapeHtml(n)} ${c}`).join(' · ')

  const daytime = facts.filter(f => f.daytime && !f.closed)
  const fast = daytime.filter(f => f.firstTouchAt !== null && minutes(f.createdAt, f.firstTouchAt) <= FAST_MIN).length
  const open = facts.filter(f => !f.closed)
  const count = (p: (f: LeadDayFacts) => boolean) => facts.filter(p).length

  const lines = [
    `📝 <b>Итог дня ${dm(run.now)}</b> — заявки в «Продажах» с ${dm(run.from)} ${fmtTime(run.from)} до ${fmtTime(run.now)}`,
    `Заявок: <b>${facts.length}</b>${people ? ` (${people})` : ''}`,
  ]
  if (facts.length) {
    lines.push(
      `Первое сообщение или звонок до ${FAST_MIN} мин: ${fast} из ${daytime.length} открытых, пришедших в рабочее время`,
      `Нет ни сообщения, ни звонка в amo: ${count(f => !f.closed && f.firstTouchAt === null)}`,
      `Клиент ждёт ответа в чате: ${count(f => f.waitingSince !== null)}`,
      `Пропущенный звонок без перезвона: ${count(f => f.missed.some(m => m.after === null))}`,
      `Нет задачи со следующим шагом: ${open.filter(f => !f.task).length} из ${open.length} открытых`,
    )
  }

  const problems = facts.filter(f => !f.closed && (byLead.get(f.leadId)?.bad.length ?? 0) > 0)
  if (problems.length) {
    lines.push('', '<b>Поправить завтра:</b>')
    for (const f of problems.slice(0, LIST_LIMIT)) {
      const bad = byLead.get(f.leadId)!.bad.map(escapeHtml).join('; ')
      lines.push(`• <a href="${f.url}">${escapeHtml(f.name.slice(0, 60))}</a> — ${escapeHtml(f.responsible)}: ${bad}`)
    }
    if (problems.length > LIST_LIMIT) lines.push(`…и ещё ${problems.length - LIST_LIMIT}`)
  }

  if (run.noDealMissed > 0) {
    lines.push('', `Пропущенных без перезвона с номеров без сделки: ${run.noDealMissed} — в разбор не попали, примечание писать некуда`)
  }
  lines.push('', run.mode === 'write'
    ? `Примечаний записано в amo: ${run.written} из ${notes.length}`
    : 'Режим пробный: в amo ничего не записано')
  return lines.join('\n')
}
