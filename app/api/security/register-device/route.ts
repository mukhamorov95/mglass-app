import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { classifyDevice } from '@/lib/deviceClass'

// Регистрация устройства при входе. Политика: 1 активное устройство на класс
// (mobile/desktop). Вход на новом устройстве того же класса вытесняет старое
// (kick-old) — шаринг аккаунта превращается в постоянные взаимные разлогины
// и целиком виден в security_events (/admin/security).

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

    const { data: active } = await svc.from('user_devices')
      .select('id, device_id, user_agent')
      .eq('user_id', user.id).eq('device_class', cls).is('revoked_at', null)
      .maybeSingle()

    if (active && active.device_id === deviceId) {
      // то же устройство — просто отметить активность
      await svc.from('user_devices')
        .update({ last_seen_at: new Date().toISOString(), last_ip: ip, user_agent: ua })
        .eq('id', active.id)
      await ev('login')
    } else {
      if (active) {
        await svc.from('user_devices')
          .update({ revoked_at: new Date().toISOString(), revoked_reason: 'replaced_by_new_login' })
          .eq('id', active.id)
        await ev('device_kicked', { old_user_agent: active.user_agent })
      }
      await svc.from('user_devices').insert({
        user_id: user.id, device_id: deviceId, device_class: cls, user_agent: ua, last_ip: ip,
      })
      await ev(active ? 'device_replaced' : 'device_registered')
    }

    // валидационный кэш для middleware — 5 минут без похода в БД
    cookieStore.set(OK_COOKIE, deviceId, { maxAge: 300, path: '/', httpOnly: true, sameSite: 'lax' })
    return NextResponse.json({ ok: true, deviceClass: cls })
  } catch (e) {
    // таблиц может ещё не быть (миграция не применена) — вход не блокируем
    return NextResponse.json({ ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : 'error' })
  }
}
