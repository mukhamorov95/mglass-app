// Серверная часть замеров: кто вызывает и общие выборки. Только для API-маршрутов —
// здесь service-role, права проверяются до него через requireMeasureActor + denyAction.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-server'
import { isOwnerRole } from '@/lib/getRole'
import { measureActorFrom, type MeasureActor } from '@/lib/measure/access'
import { DEFAULT_DURATION_MIN, DEFAULT_SCHEDULE, addDays, checkBooking, mskToIso, type Booking, type DayOff, type Schedule } from '@/lib/measure/slots'

export const REQ_COLS = 'id, deal_id, lead_id, deal_number, client_name, phone, amo_url, address, scope, notes, visit_price, payer, is_repeat, manager_id, manager_name, measurer_id, measurer_name, scheduled_at, duration_min, travel_min, status, issue_text, issue_solution, measurer_fee, fee_status, fee_paid_at, actual_price, price_note, visit_payment, photos, created_at, updated_at'

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
  travel_min: number | null
  status: string
  issue_text: string | null
  issue_solution: string | null
  measurer_fee: number
  fee_status: string
  fee_paid_at: string | null
  actual_price: number | null
  price_note: string | null
  visit_payment: 'onsite' | 'company' | 'unpaid' | null
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

const hm = (t: unknown, fallback: string) => typeof t === 'string' && t.length >= 5 ? t.slice(0, 5) : fallback

export async function loadMeasurers(svc: SupabaseClient): Promise<Measurer[]> {
  const { data, error } = await svc.from('users').select('id, name, email').eq('role', 'measurer').eq('active', true).order('name')
  if (error) throw new Error(`Замерщики не загрузились: ${error.message}`)
  const ids = (data ?? []).map(u => u.id as string)
  const schedules = new Map<string, Schedule>()
  if (ids.length) {
    const { data: sch, error: schErr } = await svc.from('measurer_schedules').select('user_id, work_days, work_from, work_to').in('user_id', ids)
    if (schErr) throw new Error(`Часы замерщиков не загрузились: ${schErr.message}`)
    for (const r of sch ?? []) {
      schedules.set(r.user_id as string, {
        work_days: ((r.work_days as number[] | null) ?? DEFAULT_SCHEDULE.work_days).map(Number),
        work_from: hm(r.work_from, DEFAULT_SCHEDULE.work_from),
        work_to: hm(r.work_to, DEFAULT_SCHEDULE.work_to),
      })
    }
  }
  return (data ?? []).map(u => ({
    id: u.id as string,
    name: (u.name as string) || (u.email as string) || 'замерщик',
    schedule: schedules.get(u.id as string) ?? DEFAULT_SCHEDULE,
  }))
}

// Выходные и отпуска, задевающие окно дат (включительно).
export async function loadDaysOff(svc: SupabaseClient, from: string, to: string, measurerId?: string): Promise<(DayOff & { id: number })[]> {
  let q = svc.from('measurer_days_off').select('id, measurer_id, date_from, date_to, note')
    .lte('date_from', to).gte('date_to', from).order('date_from')
  if (measurerId) q = q.eq('measurer_id', measurerId)
  const { data, error } = await q
  if (error) throw new Error(`Выходные замерщиков не загрузились: ${error.message}`)
  return (data ?? []) as (DayOff & { id: number })[]
}

// Проверка замерщика и времени перед записью. Жёсткий конфликт — 409 с причиной;
// мягкий без force — 409 с needsConfirm (экран спрашивает «всё равно назначить?»).
export async function tryBook(svc: SupabaseClient, p: {
  requestId?: number
  measurerId: string
  date: unknown
  time: unknown
  durationMin?: unknown
  travelMin?: unknown
  force?: unknown
}): Promise<{ measurer: Measurer; startIso: string; durationMin: number; travelMin: number | null } | NextResponse> {
  if (typeof p.date !== 'string' || !DATE_RE.test(p.date)) return NextResponse.json({ error: 'Укажи дату замера' }, { status: 400 })
  if (typeof p.time !== 'string' || !TIME_RE.test(p.time)) return NextResponse.json({ error: 'Укажи время замера (ЧЧ:ММ)' }, { status: 400 })
  const dur = Number(p.durationMin) || DEFAULT_DURATION_MIN
  if (dur < 15 || dur > 480) return NextResponse.json({ error: 'Длительность замера — от 15 минут до 8 часов' }, { status: 400 })
  // Дорога до замера от предыдущего: не указана — null (по умолчанию час), иначе 0–600 мин.
  const travel = p.travelMin == null || p.travelMin === '' ? null : Number(p.travelMin)
  if (travel !== null && (!Number.isInteger(travel) || travel < 0 || travel > 600)) {
    return NextResponse.json({ error: 'Дорога до замера — от 0 до 600 минут' }, { status: 400 })
  }

  try {
    return await checkedBooking(svc, { ...p, date: p.date, time: p.time }, dur, travel)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

async function checkedBooking(
  svc: SupabaseClient,
  p: { requestId?: number; measurerId: string; date: string; time: string; force?: unknown },
  dur: number,
  travel: number | null,
): Promise<{ measurer: Measurer; startIso: string; durationMin: number; travelMin: number | null } | NextResponse> {
  const measurers = await loadMeasurers(svc)
  const measurer = measurers.find(m => m.id === p.measurerId)
  if (!measurer) return NextResponse.json({ error: 'Замерщик не найден или не активен' }, { status: 400 })

  const startIso = mskToIso(p.date, p.time)
  const [bookings, daysOff] = await Promise.all([
    loadBookings(svc, p.date, p.date, measurer.id),
    loadDaysOff(svc, p.date, p.date, measurer.id),
  ])
  const conflicts = checkBooking({
    startIso, durationMin: dur, measurerId: measurer.id, schedule: measurer.schedule,
    daysOff, bookings, excludeId: p.requestId, travelMin: travel ?? undefined,
  })
  const hard = conflicts.filter(c => c.hard)
  if (hard.length) {
    return NextResponse.json({ error: `${measurer.name}: ${hard.map(c => c.message).join('; ')}`, conflicts }, { status: 409 })
  }
  if (conflicts.length && p.force !== true) {
    return NextResponse.json({ needsConfirm: true, warning: `${measurer.name}: ${conflicts.map(c => c.message).join('; ')}`, conflicts }, { status: 409 })
  }
  return { measurer, startIso, durationMin: dur, travelMin: travel }
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

// Чьи часы и выходные правим: замерщик — только свои, владелец — любого замерщика.
export async function targetMeasurer(svc: SupabaseClient, actor: MeasureActor, requested: unknown): Promise<Measurer | NextResponse> {
  const id = actor.role === 'measurer' ? actor.userId : String(requested ?? '')
  if (actor.role === 'measurer' && requested && requested !== actor.userId) {
    return NextResponse.json({ error: 'Замерщик правит только свой график' }, { status: 403 })
  }
  if (actor.role !== 'measurer' && !isOwnerRole(actor.role)) {
    return NextResponse.json({ error: 'График замерщика правит сам замерщик или владелец' }, { status: 403 })
  }
  if (!id) return NextResponse.json({ error: 'Выбери замерщика' }, { status: 400 })
  try {
    const m = (await loadMeasurers(svc)).find(x => x.id === id)
    return m ?? NextResponse.json({ error: 'Замерщик не найден или не активен' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
