import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { classifyDevice } from '@/lib/deviceClass'
import { deviceLimitFor } from '@/lib/deviceLimits'

// Регистрация устройства при входе. Политика: до DEVICE_LIMIT активных устройств
// на класс (01.10 — два компьютера, один телефон, один планшет). Пока есть место,
// новое устройство добавляется; когда места нет, вытесняется то, которое дольше
// всех не выходило. Всё видно в security_events (/admin/security).

const DEVICE_COOKIE = 'device-id'
const OK_COOKIE = 'device-ok'
const YEAR = 60 * 60 * 24 * 400

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const cookieStore = await cookies()
  let deviceId = cookieStore.get(DEVICE_COOKIE)?.value
  if (!deviceId) {
    deviceId = randomUUID()
    cookieStore.set(DEVICE_COOKIE, deviceId, { maxAge: YEAR, path: '/', httpOnly: true, sameSite: 'lax' })
  }
  const ua = req.headers.get('user-agent') ?? ''
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
  const cls = classifyDevice(ua)

  try {
    const svc = createServiceClient()
    const ev = (event: string, meta?: Record<string, unknown>) =>
      svc.from('security_events').insert({
        user_id: user.id, email: user.email, event,
        device_class: cls, user_agent: ua, ip, meta: meta ?? null,
      })

    // Самое «тихое» устройство — первым в очереди на вытеснение: последний выход,
    // а если его ещё не отмечали — дата регистрации.
    const { data: activeRows } = await svc.from('user_devices')
      .select('id, device_id, user_agent, last_seen_at, created_at')
      .eq('user_id', user.id).eq('device_class', cls).is('revoked_at', null)
      .order('last_seen_at', { ascending: true, nullsFirst: true })
    const active = (activeRows ?? []) as
      { id: string; device_id: string; user_agent: string | null; last_seen_at: string | null; created_at: string }[]
    const mine = active.find(d => d.device_id === deviceId)

    if (mine) {
      // то же устройство — просто отметить активность
      await svc.from('user_devices')
        .update({ last_seen_at: new Date().toISOString(), last_ip: ip, user_agent: ua })
        .eq('id', mine.id)
      await ev('login')
    } else {
      const limit = deviceLimitFor(cls)
      const kicked = active.length >= limit ? active[0] : null
      if (kicked) {
        await svc.from('user_devices')
          .update({ revoked_at: new Date().toISOString(), revoked_reason: 'replaced_by_new_login' })
          .eq('id', kicked.id)
        await ev('device_kicked', { old_user_agent: kicked.user_agent })
      }
      await svc.from('user_devices').insert({
        user_id: user.id, device_id: deviceId, device_class: cls, user_agent: ua, last_ip: ip,
        last_seen_at: new Date().toISOString(),
      })
      await ev(kicked ? 'device_replaced' : 'device_registered')
    }

    // валидационный кэш для middleware — 5 минут без похода в БД
    cookieStore.set(OK_COOKIE, deviceId, { maxAge: 300, path: '/', httpOnly: true, sameSite: 'lax' })
    return NextResponse.json({ ok: true, deviceClass: cls })
  } catch (e) {
    // таблиц может ещё не быть (миграция не применена) — вход не блокируем
    return NextResponse.json({ ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : 'error' })
  }
}
