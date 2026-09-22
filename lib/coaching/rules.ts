// «Мой день» — подсказки менеджеру на главном столе. Задача — сподвигнуть, а не пожурить
// (владелец, 22.09.2026), поэтому здесь только действия со ссылкой на клиента, одна привычка
// с понятным шагом и факты о том, что получается. Никаких рейтингов с именами: сравнение —
// с медианой команды. Считает код по правилам — подсказку можно проверить.
// Маршрут: docs/manager-coaching/COACHING_ROUTE.md. Данные собирает lib/coaching/collect.ts.

export type FocusKind = 'missed_call' | 'waiting_chat' | 'new_lead' | 'hot_deal' | 'overdue_tasks'
export type FocusItem = { kind: FocusKind; title: string; detail: string; url: string | null; at: number; weight: number; leadId: number | null }

export type HabitKey = 'reply5' | 'left_waiting' | 'overdue' | 'no_contact'
export type Habit = { key: HabitKey; title: string; fact: string; target: string; action: string }
export type Win = { title: string; detail: string }

export type Coaching = {
  amoUserId: number
  name: string
  computedAt: number
  focus: FocusItem[]
  focusMore: number
  habit: Habit | null
  wins: Win[]
  results: { days: number; leads: number; paidDeals: number; paidBudget: number; per100: number | null }
}

export type MissedFact = {
  phone: string; at: number; attempts: number
  leadId: number | null; leadName: string | null; stage: string | null; url: string | null
  kind: 'deal' | 'new' | 'none'
}
export type LeadFact = { leadId: number; leadName: string; stage: string; url: string; at: number; price?: number }

export type ManagerFacts = {
  amoUserId: number
  name: string
  week: { replies: number[]; leftWaiting: number; tasksCompleted: number; workDays: number }
  results: {
    days: number; leadsReceived: number; leadsDaytime: number; leadsNoContact: number
    firstContactMedianMin: number | null; paidDeals: number; paidBudget: number
  }
  missed: MissedFact[]
  waiting: LeadFact[]         // at — с какого момента клиент ждёт ответа
  newLeads: LeadFact[]        // at — когда пришла заявка
  hotDeals: (LeadFact & { lastTouchAt: number | null })[]
  overdue: { count: number; older30: number; oldest: { text: string; dueAt: number; url: string | null } | null }
}

export const FOCUS_LIMIT = 7
// Сколько пунктов каждого вида берём в первую очередь
const QUOTA: Record<FocusKind, number> = { missed_call: 3, waiting_chat: 3, new_lead: 2, hot_deal: 2, overdue_tasks: 1 }
const DAY = 86400
const MSK = 3 * 3600

const hm = (ts: number) => new Date((ts + MSK) * 1000).toISOString().slice(11, 16)
const dm = (ts: number) => { const d = new Date((ts + MSK) * 1000).toISOString(); return `${d.slice(8, 10)}.${d.slice(5, 7)}` }
const when = (ts: number, now: number) => (Math.floor((ts + MSK) / DAY) === Math.floor((now + MSK) / DAY) ? `сегодня в ${hm(ts)}` : `${dm(ts)} в ${hm(ts)}`)
const phoneFmt = (d: string) => (d.length === 10 ? `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}` : d)
const times = (n: number) => `${n} ${n % 10 >= 2 && n % 10 <= 4 && (n < 10 || n > 20) ? 'раза' : 'раз'}`
const isHot = (stage: string | null) => !!stage && /кп|счет|счёт/i.test(stage)
const dec = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')
const rub = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace('.', ',')} млн ₽` : `${Math.round(n / 1000)} тыс ₽`)

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Доля ответов в первые 5 минут — null, если ответов мало и доля ничего не значит
export const reply5Share = (replies: number[]) =>
  replies.length >= 10 ? Math.round((replies.filter(m => m <= 5).length / replies.length) * 100) : null
const per100 = (r: ManagerFacts['results']) => (r.leadsReceived >= 20 ? Math.round((r.paidDeals / r.leadsReceived) * 1000) / 10 : null)
const noContactShare = (r: ManagerFacts['results']) => (r.leadsDaytime >= 10 ? Math.round((r.leadsNoContact / r.leadsDaytime) * 100) : null)

export function buildFocus(me: ManagerFacts, now: number): { focus: FocusItem[]; more: number } {
  const items: FocusItem[] = []
  for (const m of me.missed) {
    const tail = m.attempts > 1 ? ` · звонил ${times(m.attempts)}, последний ${when(m.at, now)}` : ` · звонил ${when(m.at, now)}`
    items.push({
      kind: 'missed_call',
      title: `Перезвони ${phoneFmt(m.phone)}`,
      detail: m.kind === 'deal' ? `«${m.leadName}» · ${m.stage}${tail}` : m.kind === 'new' ? `новый номер${tail}` : `номера нет в amo${tail}`,
      url: m.url ?? `tel:+7${m.phone}`,
      at: m.at,
      weight: m.kind === 'deal' ? (isHot(m.stage) ? 100 : 90) : m.kind === 'new' ? 85 : 80,
      leadId: m.leadId,
    })
  }
  for (const w of me.waiting) {
    items.push({
      kind: 'waiting_chat', title: `Ответь в чате: «${w.leadName}»`,
      detail: `клиент ждёт ответа с ${when(w.at, now)} · ${w.stage}`, url: w.url, at: w.at,
      weight: isHot(w.stage) ? 85 : 75, leadId: w.leadId,
    })
  }
  for (const l of me.newLeads) {
    items.push({
      kind: 'new_lead', title: `Свяжись с новой заявкой «${l.leadName}»`,
      detail: `пришла ${when(l.at, now)}, исходящих сообщений и звонков по ней ещё не было`, url: l.url, at: l.at,
      weight: 70, leadId: l.leadId,
    })
  }
  for (const h of me.hotDeals) {
    const days = h.lastTouchAt === null ? null : Math.floor((now - h.lastTouchAt) / DAY)
    items.push({
      kind: 'hot_deal', title: `Напомни о себе: «${h.leadName}»`,
      detail: `${h.stage}${h.price ? ` · ${rub(h.price)}` : ''} · ${days === null ? 'за неделю ни одного исходящего касания' : `последнее касание ${days} дн. назад`}`,
      url: h.url, at: h.lastTouchAt ?? h.at, weight: 60 + Math.min(Math.floor((h.price ?? 0) / 100_000), 10), leadId: h.leadId,
    })
  }
  if (me.overdue.count > 0 && me.overdue.oldest) {
    items.push({
      kind: 'overdue_tasks', title: `Разбери просроченные задачи: ${me.overdue.count}`,
      detail: `самая старая — «${me.overdue.oldest.text || 'без текста'}», срок был ${dm(me.overdue.oldest.dueAt)}`,
      url: me.overdue.oldest.url, at: me.overdue.oldest.dueAt, weight: 40, leadId: null,
    })
  }
  // Один клиент — один пункт: самый срочный повод по нему
  const byLead = new Map<number, FocusItem>()
  const rest: FocusItem[] = []
  for (const it of items) {
    if (it.leadId === null) { rest.push(it); continue }
    const prev = byLead.get(it.leadId)
    if (!prev || it.weight > prev.weight) byLead.set(it.leadId, it)
  }
  const all = [...byLead.values(), ...rest].sort((a, b) => b.weight - a.weight || a.at - b.at)
  // Квоты по видам: иначе десяток чатов занимает весь список, и горячие сделки с новыми
  // заявками не видны ни разу. Сначала по квоте каждого вида, потом добор по весу.
  const left = { ...QUOTA }
  const picked = all.filter(it => (left[it.kind] > 0 ? (left[it.kind]--, true) : false))
  for (const it of all) {
    if (picked.length >= FOCUS_LIMIT) break
    if (!picked.includes(it)) picked.push(it)
  }
  const focus = picked.slice(0, FOCUS_LIMIT).sort((a, b) => b.weight - a.weight || a.at - b.at)
  return { focus, more: Math.max(0, all.length - focus.length) }
}

export function pickHabit(me: ManagerFacts, team: ManagerFacts[]): Habit | null {
  const cands: (Habit & { score: number })[] = []

  const mine5 = reply5Share(me.week.replies)
  const team5 = median(team.map(t => reply5Share(t.week.replies)).filter((x): x is number => x !== null))
  if (mine5 !== null && team5 !== null && team5 - mine5 >= 10) {
    cands.push({
      key: 'reply5', score: team5 - mine5,
      title: 'Первые 5 минут',
      fact: `За неделю в первые 5 минут ответ получили ${mine5}% клиентов, которые написали днём.`,
      target: `Медиана команды — ${Math.round(team5)}%.`,
      action: 'Держи чаты amo открытыми и отвечай сразу, хотя бы коротко: «Здравствуйте, уже смотрю».',
    })
  }
  if (me.week.leftWaiting >= 3) {
    cands.push({
      key: 'left_waiting', score: me.week.leftWaiting * 5,
      title: 'Не оставлять клиентов на вечер',
      fact: `За неделю ${me.week.leftWaiting} клиентов написали вечером после твоего последнего действия и ждали ответа до утра.`,
      target: 'Цель — ни одного.',
      action: 'Последние 15 минут дня — чаты и пропущенные. Уходишь раньше — передай клиентов коллеге.',
    })
  }
  if (me.overdue.count >= 15) {
    cands.push({
      key: 'overdue', score: Math.min(me.overdue.count / 2, 60),
      title: 'Разобрать хвост задач',
      fact: `Просроченных задач ${me.overdue.count}${me.overdue.older30 ? `, из них ${me.overdue.older30} старше месяца` : ''}.`,
      target: 'Просроченная задача — это клиент, которому обещали звонок и не позвонили.',
      action: 'Каждое утро закрой или честно перенеси 10 самых старых.',
    })
  }
  const mineNc = noContactShare(me.results)
  const teamNc = median(team.map(t => noContactShare(t.results)).filter((x): x is number => x !== null))
  if (mineNc !== null && mineNc >= 15 && (teamNc === null || mineNc - teamNc >= 5)) {
    cands.push({
      key: 'no_contact', score: mineNc,
      title: 'Каждой новой заявке — контакт',
      fact: `${me.results.leadsNoContact} из ${me.results.leadsDaytime} дневных заявок за ${me.results.days} дней остались без исходящего сообщения или звонка.`,
      target: teamNc === null ? 'Цель — ни одной.' : `Медиана команды — ${Math.round(teamNc)}%.`,
      action: 'Новая заявка — сообщение или звонок в первые 15 минут, даже если это «получили, скоро пришлю расчёт».',
    })
  }
  cands.sort((a, b) => b.score - a.score)
  if (!cands[0]) return null
  const { score: _score, ...habit } = cands[0]
  void _score
  return habit
}

export function pickWins(me: ManagerFacts, team: ManagerFacts[]): Win[] {
  const wins: (Win & { strength: number })[] = []
  const my100 = per100(me.results)
  const team100 = median(team.map(t => per100(t.results)).filter((x): x is number => x !== null))
  if (my100 !== null && team100 !== null && team100 > 0 && my100 >= team100 * 0.95) {
    wins.push({
      title: my100 > team100 * 1.05 ? 'Конверсия выше команды' : 'Конверсия на уровне команды',
      detail: `${dec(my100)} оплат на 100 заявок за ${me.results.days} дней (медиана команды — ${dec(team100)}).`,
      strength: my100 / team100,
    })
  }
  const myFc = me.results.firstContactMedianMin
  const teamFc = median(team.map(t => t.results.firstContactMedianMin).filter((x): x is number => x !== null))
  if (myFc !== null && myFc <= 5 && (teamFc === null || myFc <= teamFc)) {
    wins.push({ title: 'Быстрый первый контакт', detail: `С новой заявкой связываешься за ${myFc} мин (медиана).`, strength: 1.2 })
  }
  const mine5 = reply5Share(me.week.replies)
  const team5 = median(team.map(t => reply5Share(t.week.replies)).filter((x): x is number => x !== null))
  if (mine5 !== null && team5 !== null && mine5 >= team5 + 5) {
    wins.push({ title: 'Отвечаешь быстро', detail: `За неделю ${mine5}% клиентов получили ответ в первые 5 минут (медиана команды — ${Math.round(team5)}%).`, strength: mine5 / Math.max(team5, 1) })
  }
  const teamTasks = median(team.map(t => t.week.tasksCompleted))
  if (me.week.tasksCompleted >= 10 && teamTasks !== null && me.week.tasksCompleted >= teamTasks) {
    wins.push({ title: 'Задачи закрываются', detail: `За неделю закрыто задач: ${me.week.tasksCompleted}.`, strength: me.week.tasksCompleted / Math.max(teamTasks, 1) })
  }
  if (me.week.workDays >= 3 && me.week.leftWaiting === 0) {
    wins.push({ title: 'Никто не ждал до утра', detail: 'За неделю ни один клиент не остался без ответа на вечер.', strength: 1.1 })
  }
  return wins.sort((a, b) => b.strength - a.strength).slice(0, 2).map(({ title, detail }) => ({ title, detail }))
}

export function coach(me: ManagerFacts, team: ManagerFacts[], now: number): Coaching {
  const { focus, more } = buildFocus(me, now)
  return {
    amoUserId: me.amoUserId,
    name: me.name,
    computedAt: now,
    focus,
    focusMore: more,
    habit: pickHabit(me, team),
    wins: pickWins(me, team),
    results: {
      days: me.results.days, leads: me.results.leadsReceived, paidDeals: me.results.paidDeals,
      paidBudget: me.results.paidBudget, per100: per100(me.results),
    },
  }
}
