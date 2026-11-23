import { NextResponse, type NextRequest } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { loadTeam, seatsUsed } from '@/lib/partner/team'

// Наш обзор команды клиента (docs/PARTNER_TEAM_ROUTE.md, Т3): люди, роли, логины, заходы, просчёты.
// Только владелец. Паролей здесь нет: они хранятся только хешем в Supabase Auth.

export async function GET(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const clientId = Number(req.nextUrl.searchParams.get('clientId'))
  if (!Number.isInteger(clientId) || clientId <= 0) return NextResponse.json({ error: 'Нужен клиент' }, { status: 400 })
  const svc = createServiceClient()
  const { data: c, error } = await svc.from('b2b_clients').select('id, name, max_members, owner_name').eq('id', clientId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!c) return NextResponse.json({ error: 'Клиент не найден' }, { status: 404 })
  try {
    const team = await loadTeam(svc, clientId)
    return NextResponse.json({ team, seats: { used: seatsUsed(team), max: c.max_members ?? 10 }, ownerName: c.owner_name ?? null })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// Лимит мест и имя руководителя карточки: { clientId, maxMembers?, ownerName? }.
export async function PATCH(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const clientId = Number(body.clientId)
  if (!Number.isInteger(clientId) || clientId <= 0) return NextResponse.json({ error: 'Нужен клиент' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (body.maxMembers !== undefined) {
    const n = Number(body.maxMembers)
    if (!Number.isInteger(n) || n < 1 || n > 100) return NextResponse.json({ error: 'Мест — от 1 до 100' }, { status: 400 })
    patch.max_members = n
  }
  if (body.ownerName !== undefined) patch.owner_name = String(body.ownerName ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || null
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Нечего менять' }, { status: 400 })
  const { data, error } = await createServiceClient().from('b2b_clients').update(patch).eq('id', clientId).select('id')
  if (error) return NextResponse.json({ error: `Не сохранено: ${error.message}` }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Клиент не найден' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
