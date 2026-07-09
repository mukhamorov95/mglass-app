import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Обзор безопасности для владельца: активные устройства по пользователям +
// журнал событий. POST — принудительно отключить устройство (logout_forced).

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const svc = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const [devs, evs, users, act] = await Promise.all([
    svc.from('user_devices').select('*').order('last_seen_at', { ascending: false }).limit(500),
    svc.from('security_events').select('*').order('created_at', { ascending: false }).limit(200),
    svc.from('users').select('id, name, email'),
    svc.from('user_activity_days').select('*').eq('day', today).order('first_seen'),
  ])
  return NextResponse.json({
    devices: devs.data ?? [],
    events: evs.data ?? [],
    users: users.data ?? [],
    activity: act.data ?? [],
    errors: [devs.error?.message, evs.error?.message].filter(Boolean),
  })
}

export async function POST(req: Request) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const svc = createServiceClient()
  const { data: dev } = await svc.from('user_devices').select('*').eq('id', id).maybeSingle()
  if (!dev) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await svc.from('user_devices')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: 'revoked_by_admin' })
    .eq('id', id)
  await svc.from('security_events').insert({
    user_id: dev.user_id, event: 'logout_forced',
    device_class: dev.device_class, user_agent: dev.user_agent, ip: dev.last_ip,
  })
  return NextResponse.json({ ok: true })
}
