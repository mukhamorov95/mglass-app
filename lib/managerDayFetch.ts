import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAmoActivity } from '@/lib/amoActivityFetch'
import { fetchAmoResults } from '@/lib/amoResultsFetch'
import { fetchPbxReport } from '@/lib/pbxCallsFetch'
import { getAmoUserNames } from '@/lib/amoPeople'
import { mskDayStart } from '@/lib/amoActivity'
import { buildDayRows, countAppDocs, type ManagerDayRow } from '@/lib/managerDay'

// Сбор одного дня для manager_day_stats. Только GET к AmoCRM и АТС.
// Запросы к amo — по очереди: разом это больше 7 в секунду, и amo отвечает 429.

export type DaySnapshot = { day: string; rows: ManagerDayRow[]; problems: string[] }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function collectManagerDay(sb: SupabaseClient, day: string): Promise<DaySnapshot> {
  const from = mskDayStart(day)
  const to = from + 86400
  const problems: string[] = []

  // Без активности amo дня нет — пусть ошибка всплывёт целиком.
  const activity = await fetchAmoActivity(from, to)
  const results = await fetchAmoResults(from, to).catch(e => { problems.push(`этапы amo: ${msg(e)}`); return null })
  const pbxReport = await fetchPbxReport(from, to).catch(e => { problems.push(`АТС: ${msg(e)}`); return null })
  const pbx = pbxReport?.configured ? pbxReport.summary.byUser : null
  if (pbxReport && !pbxReport.configured) problems.push('АТС не подключена — звонки только из amo')

  const range = { from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString() }
  const [users, calcs, kp, contracts, names] = await Promise.all([
    sb.from('users').select('id, amo_user_id'),
    sb.from('calculations').select('created_by, product_type').gte('created_at', range.from).lt('created_at', range.to).limit(5000),
    sb.from('commercial_proposals').select('manager_id').gte('created_at', range.from).lt('created_at', range.to).limit(5000),
    sb.from('contracts').select('manager_id').gte('created_at', range.from).lt('created_at', range.to).limit(5000),
    getAmoUserNames(),
  ])
  for (const [what, r] of [['users', users], ['calculations', calcs], ['commercial_proposals', kp], ['contracts', contracts]] as const) {
    if (r.error) problems.push(`${what}: ${r.error.message}`)
  }
  const docs = countAppDocs({
    users: (users.data ?? []) as { id: string; amo_user_id: number | null }[],
    calcs: (calcs.data ?? []) as { created_by: string | null; product_type: string | null }[],
    kp: (kp.data ?? []) as { manager_id: string | null }[],
    contracts: (contracts.data ?? []) as { manager_id: string | null }[],
  })

  const rows = buildDayRows({ day, activity, results, pbx, docs, names: new Map(names.map(u => [u.id, u.name])) })
  return { day, rows, problems }
}
