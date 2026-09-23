import 'server-only'
import { amoGetAll, getDomain } from '@/lib/amocrm'
import { mskDay, mskDayStart } from '@/lib/amoActivity'
import { buildFromRaw, fetchActivityRaw } from '@/lib/amoActivityFetch'
import { fetchAmoResults } from '@/lib/amoResultsFetch'
import { fetchPbxReport } from '@/lib/pbxCallsFetch'
import type { MissedClient } from '@/lib/missedClients'
import { coach, type Coaching, type ManagerFacts } from '@/lib/coaching/rules'
import { emptyFocus, fetchHotAndNew, focusFacts, stageMaps, type Lead, type Task } from '@/lib/coaching/focus'

// Полный сбор «Моего дня» по всем менеджерам сразу: медиана команды нужна каждому.
// Только GET к AmoCRM, около минуты запросов — поэтому живёт в кроне, а не на открытии
// страницы. Поводы «Сделай сегодня» считает lib/coaching/focus.ts — тем же кодом, что и
// кнопка «Обновить», иначе утренний список и живой разошлись бы.

const DAY = 86400

export type CoachingRun = { computedAt: number; coachings: Coaching[]; unassignedMissed: MissedClient[] }

export async function collectCoaching(managers: { id: number; name: string }[], now = Math.floor(Date.now() / 1000)): Promise<CoachingRun> {
  const domain = getDomain()
  const todayStart = mskDayStart(mskDay(now))
  const weekFrom = todayStart - 7 * DAY
  const ids = new Set(managers.map(m => m.id))

  const raw = await fetchActivityRaw(weekFrom, now)
  const week = buildFromRaw(weekFrom, now, raw)
  const results = await fetchAmoResults(todayStart - 90 * DAY, todayStart)
  const pbx = await fetchPbxReport(todayStart - DAY, now).catch(() => null)

  const { stageName, hot } = await stageMaps()
  const { hotLeads, newLeads } = await fetchHotAndNew(hot, now)
  const tasks = await amoGetAll<Task>('/tasks', { 'filter[is_completed]': '0' }, 'tasks')

  const focus = focusFacts({
    ids, now, events: raw.events,
    leadsById: new Map(raw.leads.map(l => [l.id, l as Lead])),
    stageName, hotLeads, newLeads, tasks, pbx, domain,
  })

  const facts: ManagerFacts[] = managers.map(({ id, name }) => {
    const w = week.managers.find(m => m.userId === id)
    const r = results.managers.find(m => m.userId === id)
    return {
      amoUserId: id,
      name,
      week: {
        replies: w ? w.days.flatMap(d => d.replyMinutes) : [],
        leftWaiting: w?.total.leftWaiting ?? 0,
        tasksCompleted: w?.total.tasksCompleted ?? 0,
        workDays: w?.workDays ?? 0,
      },
      results: {
        days: 90,
        leadsReceived: r?.leadsReceived ?? 0, leadsDaytime: r?.leadsDaytime ?? 0, leadsNoContact: r?.leadsNoContact ?? 0,
        firstContactMedianMin: r?.firstContactMedianMin ?? null, paidDeals: r?.paidDeals ?? 0, paidBudget: r?.paidBudget ?? 0,
      },
      ...(focus.get(id) ?? emptyFocus()),
    }
  })

  const unassignedMissed = (pbx && pbx.configured ? pbx.missed : [])
    .filter(m => m.after === null && m.owner.kind === 'none' && m.rangToIds.length === 0)

  return { computedAt: now, coachings: facts.map(f => coach(f, facts, now)), unassignedMissed }
}
