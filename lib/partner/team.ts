import type { SupabaseClient } from '@supabase/supabase-js'
import { isTeamRole, type TeamRole } from '@/lib/partner/teamRoles'
import { mskDayKeyAgo } from '@/lib/time'

// Команда партнёра: кто в ней, роль, когда заходил. Читают кабинет руководителя
// (/api/partner/team) и наш обзор (/api/admin/b2b-access). Паролей здесь нет и быть не может:
// они только в Supabase Auth хешем.

export type TeamMember = {
  userId: string
  name: string | null
  email: string | null
  role: TeamRole
  primary: boolean          // логин карточки клиента (b2b_clients.user_id) — всегда руководитель
  disabled: boolean
  invitedBy: string | null
  createdAt: string | null
  lastSeen: string | null   // последний заход (user_activity_days.last_seen)
  days30: number            // дней с заходами за 30 дней
  quotes30: number          // просчётов создано за 30 дней (b2b_orders.created_by)
  passwordSet: boolean      // перешёл по ссылке и задал пароль
}

export const ACTIVE_WINDOW_DAYS = 30

export async function loadTeam(svc: SupabaseClient, clientId: number): Promise<TeamMember[]> {
  const { data: client, error: cErr } = await svc.from('b2b_clients').select('id, user_id, owner_name').eq('id', clientId).maybeSingle()
  if (cErr) throw new Error(`Клиент не прочитан: ${cErr.message}`)
  if (!client) return []
  const { data: rows, error: mErr } = await svc.from('b2b_client_members')
    .select('user_id, role, name, disabled_at, invited_by_name, created_at').eq('client_id', clientId).order('created_at')
  if (mErr) throw new Error(`Команда не прочитана: ${mErr.message}`)

  const base: Omit<TeamMember, 'email' | 'lastSeen' | 'days30' | 'quotes30' | 'passwordSet'>[] = []
  if (client.user_id) base.push({ userId: client.user_id as string, name: (client.owner_name as string | null) ?? null, role: 'admin', primary: true, disabled: false, invitedBy: 'M-Glass', createdAt: null })
  for (const r of rows ?? []) {
    if (r.user_id === client.user_id) continue
    base.push({
      userId: r.user_id as string, name: (r.name as string | null) ?? null,
      role: isTeamRole(r.role) ? r.role : 'manager', primary: false, disabled: !!r.disabled_at,
      invitedBy: (r.invited_by_name as string | null) ?? null, createdAt: (r.created_at as string | null) ?? null,
    })
  }
  const ids = base.map(b => b.userId)
  if (ids.length === 0) return []

  const since = mskDayKeyAgo(ACTIVE_WINDOW_DAYS - 1)
  const [users, days, quotes, tokens] = await Promise.all([
    svc.from('users').select('id, email').in('id', ids),
    svc.from('user_activity_days').select('user_id, day, last_seen').in('user_id', ids).gte('day', since),
    svc.from('b2b_orders').select('created_by').eq('client_id', clientId).in('created_by', ids).gte('created_at', `${since}T00:00:00+03:00`),
    svc.from('user_setup_tokens').select('user_id, used_at').in('user_id', ids),
  ])
  for (const r of [users, days, quotes, tokens]) if (r.error) throw new Error(`Активность не прочитана: ${r.error.message}`)
  // Последний заход — за всё время, не только за окно.
  const { data: lastRows, error: lErr } = await svc.from('user_activity_days').select('user_id, last_seen').in('user_id', ids).order('last_seen', { ascending: false }).limit(ids.length * 5)
  if (lErr) throw new Error(`Активность не прочитана: ${lErr.message}`)

  const email = new Map((users.data ?? []).map(u => [u.id as string, (u.email as string | null) ?? null]))
  const last = new Map<string, string>()
  for (const r of lastRows ?? []) if (!last.has(r.user_id as string)) last.set(r.user_id as string, r.last_seen as string)
  const dayCount = new Map<string, number>()
  for (const r of days.data ?? []) dayCount.set(r.user_id as string, (dayCount.get(r.user_id as string) ?? 0) + 1)
  const quoteCount = new Map<string, number>()
  for (const r of quotes.data ?? []) quoteCount.set(r.created_by as string, (quoteCount.get(r.created_by as string) ?? 0) + 1)
  // Пароль задан: был заход или использована ссылка. Неиспользованная ссылка без заходов — ещё нет.
  const tokenUsed = new Set((tokens.data ?? []).filter(t => t.used_at).map(t => t.user_id as string))
  const tokenOpen = new Set((tokens.data ?? []).filter(t => !t.used_at).map(t => t.user_id as string))

  return base.map(b => ({
    ...b,
    email: email.get(b.userId) ?? null,
    lastSeen: last.get(b.userId) ?? null,
    days30: dayCount.get(b.userId) ?? 0,
    quotes30: quoteCount.get(b.userId) ?? 0,
    passwordSet: last.has(b.userId) || tokenUsed.has(b.userId) || !tokenOpen.has(b.userId),
  }))
}

export const seatsUsed = (team: TeamMember[]) => team.filter(m => !m.disabled).length
