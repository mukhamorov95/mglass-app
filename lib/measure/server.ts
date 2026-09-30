// Серверная часть замеров: кто вызывает и общие выборки. Только для API-маршрутов —
// здесь service-role, права проверяются до него через requireMeasureActor + denyAction.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-server'
import { measureActorFrom, type MeasureActor } from '@/lib/measure/access'
import { DEFAULT_DURATION_MIN, DEFAULT_SCHEDULE, addDays, checkBooking, mskToIso, type Booking, type DayOff, type Schedule } from '@/lib/measure/slots'

export const REQ_COLS = 'id, deal_id, lead_id, deal_number, client_name, phone, amo_url, address, scope, notes, visit_price, payer, is_repeat, manager_id, manager_name, measurer_id, measurer_name, scheduled_at, duration_min, status, issue_text, issue_solution, measurer_fee, fee_status, fee_paid_at, photos, created_at, updated_at'

export type MeasureRequestRow = {
  id: number
  deal_id: number | null
  lead_id: number | null
  deal_number: string | null
  client_name: string
  phone: string | null
  amo_url: string | null
  address: string | null
  scope: string | null
  notes: string | null
  visit_price: number
  payer: string | null
  is_repeat: boolean
  manager_id: string | null
  manager_name: string | null
  measurer_id: string | null
  measurer_name: string | null
  scheduled_at: string | null
  duration_min: number | null
  status: string
  issue_text: string | null
  issue_solution: string | null
  measurer_fee: number
  fee_status: string
  fee_paid_at: string | null
  photos: string[] | null
  created_at: string
  updated_at: string
}

export async function requireMeasureActor(): Promise<MeasureActor | NextResponse> {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const { data: p, error } = await sb.from('users')
    .select('role, name, can_view_all_clients, permissions').eq('id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: `Профиль не прочитан: ${error.message}` }, { status: 500 })
  const perms = (p?.permissions ?? null) as { manager_workspace?: unknown } | null
  const actor = measureActorFrom({
    userId: user.id,
    name: (p?.name as string | null) ?? null,
    email: user.email,
    role: (p?.role as string | undefined) ?? '',
    canViewAllClients: p?.can_view_all_clients as boolean | null,
    managerWorkspace: perms?.manager_workspace === true,
  })
  if (!actor) return NextResponse.json({ error: 'Нет доступа к замерам' }, { status: 403 })
  return actor
}

export type Measurer = { id: string; name: string; schedule: Schedule }

export async function loadMeasurers(svc: SupabaseClient): Promise<Measurer[]> {
  const { data, error } = await svc.from('users').select('id, name, email').eq('role', 'measurer').eq('active', true).order('name')
  if (error) throw new Error(`Замерщики не загрузились: ${error.message}`)
  return (data ?? []).map(u => ({ id: u.id as string, name: (u.name as string) || (u.email as string) || 'замерщик', schedule: DEFAULT_SCHEDULE }))
}

// Проверка замерщика и времени перед записью. Жёсткий конфликт — 409 с причиной;
// мягкий без force — 409 с needsConfirm (экран спрашивает «всё равно назначить?»).
export async function tryBook(svc: SupabaseClient, p: {
  requestId?: number
  measurerId: string
  date: unknown
  time: unknown
  durationMin?: unknown
  force?: unknown
  daysOff?: DayOff[]
}): Promise<{ measurer: Measurer; startIso: string; durationMin: number } | NextResponse> {
  if (typeof p.date !== 'string' || !DATE_RE.test(p.date)) return NextResponse.json({ error: 'Укажи дату замера' }, { status: 400 })
  if (typeof p.time !== 'string' || !TIME_RE.test(p.time)) return NextResponse.json({ error: 'Укажи время замера (ЧЧ:ММ)' }, { status: 400 })
  const dur = Number(p.durationMin) || DEFAULT_DURATION_MIN
  if (dur < 15 || dur > 480) return NextResponse.json({ error: 'Длительность замера — от 15 минут до 8 часов' }, { status: 400 })

  const measurers = await loadMeasurers(svc)
  const measurer = measurers.find(m => m.id === p.measurerId)
  if (!measurer) return NextResponse.json({ error: 'Замерщик не найден или не активен' }, { status: 400 })

  const startIso = mskToIso(p.date, p.time)
  const bookings = await loadBookings(svc, p.date, p.date, measurer.id)
  const conflicts = checkBooking({
    startIso, durationMin: dur, measurerId: measurer.id, schedule: measurer.schedule,
    daysOff: p.daysOff ?? [], bookings, excludeId: p.requestId,
  })
  const hard = conflicts.filter(c => c.hard)
  if (hard.length) {
    return NextResponse.json({ error: `${measurer.name}: ${hard.map(c => c.message).join('; ')}`, conflicts }, { status: 409 })
  }
  if (conflicts.length && p.force !== true) {
    return NextResponse.json({ needsConfirm: true, warning: `${measurer.name}: ${conflicts.map(c => c.message).join('; ')}`, conflicts }, { status: 409 })
  }
  return { measurer, startIso, durationMin: dur }
}

// Занятость замерщиков в окне дат (по Москве, включительно).
export async function loadBookings(svc: SupabaseClient, from: string, to: string, measurerId?: string): Promise<(Booking & MeasureRequestRow)[]> {
  let q = svc.from('measure_requests').select(REQ_COLS)
    .in('status', ['scheduled', 'done', 'issue'])
    .not('measurer_id', 'is', null)
    .gte('scheduled_at', mskToIso(from, '00:00'))
    .lt('scheduled_at', mskToIso(addDays(to, 1), '00:00'))
    .order('scheduled_at')
  if (measurerId) q = q.eq('measurer_id', measurerId)
  const { data, error } = await q
  if (error) throw new Error(`Замеры не загрузились: ${error.message}`)
  return (data ?? []) as unknown as (Booking & MeasureRequestRow)[]
}

// Обрезка свободного текста из формы: длинная вставка не должна ложиться в базу целиком.
export function text(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export function money(v: unknown): number {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
