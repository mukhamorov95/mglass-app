import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Графики менеджеров — норма для /commercial/activity. Читают владелец и коммерческий,
// меняет только владелец: это договорённость с человеком, а не настройка экрана.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export async function GET() {
  const guard = await requireRole(['admin', 'ceo', 'commercial'])
  if (guard instanceof NextResponse) return guard
  const { data, error } = await createServiceClient()
    .from('manager_schedules')
    .select('amo_user_id, name, starts_on, work_from, work_to, work_days, note')
    .order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ schedules: data ?? [] })
}

export async function PUT(req: Request) {
  const guard = await requireRole(['admin', 'ceo'])
  if (guard instanceof NextResponse) return guard

  const b = await req.json().catch(() => null) as Record<string, unknown> | null
  const amoUserId = Number(b?.amo_user_id)
  const name = typeof b?.name === 'string' ? b.name.trim() : ''
  const startsOn = b?.starts_on ? String(b.starts_on) : null
  const workFrom = b?.work_from ? String(b.work_from) : null
  const workTo = b?.work_to ? String(b.work_to) : null
  const workDays = Array.isArray(b?.work_days) ? [...new Set(b.work_days.map(Number))].sort() : [1, 2, 3, 4, 5]
  const note = typeof b?.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null

  if (!Number.isInteger(amoUserId) || amoUserId <= 0 || !name) return NextResponse.json({ error: 'Нужны amo_user_id и имя' }, { status: 400 })
  if (startsOn && !DAY_RE.test(startsOn)) return NextResponse.json({ error: 'Дата выхода — ГГГГ-ММ-ДД' }, { status: 400 })
  if ((workFrom && !TIME_RE.test(workFrom)) || (workTo && !TIME_RE.test(workTo))) return NextResponse.json({ error: 'Время — ЧЧ:ММ' }, { status: 400 })
  if (workFrom && workTo && workFrom >= workTo) return NextResponse.json({ error: 'Начало смены должно быть раньше конца' }, { status: 400 })
  if (workDays.some(d => !Number.isInteger(d) || d < 1 || d > 7)) return NextResponse.json({ error: 'Дни недели — от 1 (пн) до 7 (вс)' }, { status: 400 })

  const { data: { user } } = await (await createClient()).auth.getUser()
  const { error } = await createServiceClient().from('manager_schedules').upsert({
    amo_user_id: amoUserId, name, starts_on: startsOn, work_from: workFrom, work_to: workTo,
    work_days: workDays, note, updated_at: new Date().toISOString(), updated_by: user?.id ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
