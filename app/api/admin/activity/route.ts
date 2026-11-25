import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Отчёт по активности пользователей: за период [from,to] по каждому — во сколько
// начинает/заканчивает (типичное, московское время) и сколько времени в приложении
// (окно присутствия: первый заход → последний за день). Только владелец.
// Точность ~5 минут (тик из middleware). Колонка day хранится в UTC-дате.

type ActRow = { user_id: string; day: string; first_seen: string; last_seen: string }
type U = { id: string; name: string | null; email: string | null; role: string | null }

// Секунды от полуночи по Москве (для усреднения времени начала/конца).
function moscowSecondsOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(iso))
  const g = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  return g('hour') * 3600 + g('minute') * 60 + g('second')
}
const hhmm = (secs: number) => {
  const s = Math.round(secs)
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const sp = req.nextUrl.searchParams
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const now = new Date()
  const to = sp.get('to') || iso(now)
  const from = sp.get('from') || iso(new Date(now.getTime() - 29 * 86400000))

  const svc = createServiceClient()
  const { data } = await svc.from('user_activity_days')
    .select('user_id,day,first_seen,last_seen').gte('day', from).lte('day', to)
  const list = (data ?? []) as ActRow[]
  // Активные минуты: считаются с 25.11.2026; до этого дня их нет — показываем прочерк, а не ноль.
  const [{ data: am }, { data: since }] = await Promise.all([
    svc.from('user_active_minutes').select('user_id,day,minutes').gte('day', from).lte('day', to),
    svc.from('user_active_minutes').select('day').order('day').limit(1),
  ])
  const activeSince = (since?.[0] as { day?: string } | undefined)?.day ?? null
  const activeBy = new Map<string, { min: number; days: number }>()
  for (const r of (am ?? []) as { user_id: string; minutes: number }[]) {
    const g = activeBy.get(r.user_id) ?? { min: 0, days: 0 }
    g.min += Number(r.minutes) || 0; g.days++
    activeBy.set(r.user_id, g)
  }

  const uids = [...new Set(list.map(r => r.user_id))]
  const { data: us } = uids.length
    ? await svc.from('users').select('id,name,email,role').in('id', uids)
    : { data: [] }
  const umap = new Map<string, U>(((us ?? []) as U[]).map(u => [u.id, u]))

  const byUser = new Map<string, { start: number[]; end: number[]; span: number[]; last: string }>()
  for (const r of list) {
    const g = byUser.get(r.user_id) ?? { start: [], end: [], span: [], last: '' }
    g.start.push(moscowSecondsOfDay(r.first_seen))
    g.end.push(moscowSecondsOfDay(r.last_seen))
    g.span.push(Math.max(0, (new Date(r.last_seen).getTime() - new Date(r.first_seen).getTime()) / 3600000))
    if (!g.last || r.last_seen > g.last) g.last = r.last_seen
    byUser.set(r.user_id, g)
  }
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

  const rows = [...byUser.entries()].map(([uid, g]) => {
    const u = umap.get(uid)
    return {
      name: (u?.name?.trim()) || u?.email || uid.slice(0, 8),
      role: u?.role ?? '—',
      days: g.span.length,
      start: hhmm(avg(g.start)),
      end: hhmm(avg(g.end)),
      avgHours: Math.round(avg(g.span) * 10) / 10,
      totalHours: Math.round(sum(g.span) * 10) / 10,
      lastActive: g.last,
      // null — за период минуты ещё не считались (до activeSince), 0 — считались, но не было действий.
      activeTotalHours: activeSince && to >= activeSince ? Math.round(((activeBy.get(uid)?.min ?? 0) / 60) * 10) / 10 : null,
      // В среднем за день, когда минуты шли (день без действий в таблицу не попадает).
      activeAvgHours: activeSince && to >= activeSince
        ? Math.round(((activeBy.get(uid)?.min ?? 0) / 60 / Math.max(1, activeBy.get(uid)?.days ?? 1)) * 10) / 10
        : null,
    }
  }).sort((a, b) => (b.activeTotalHours ?? -1) - (a.activeTotalHours ?? -1) || b.totalHours - a.totalHours)

  return NextResponse.json({ from, to, rows, activeSince })
}
