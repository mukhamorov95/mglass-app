import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isOwnerRole } from '@/lib/getRole'
import { verifyOwner2faCode } from '@/lib/owner2fa'
import { OWNER_2FA_COOKIE, owner2faSecret, mintOwner2faCookie } from '@/lib/owner2faCookie'

// Проверить код второго фактора. При успехе ставим подписанную куку
// owner-2fa-ok — по ней middleware пускает владельца в приложение. Кука живёт
// 30 дней и привязана к устройству (одно устройство на класс — device-limit).
const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const { data: prof } = await svc.from('users').select('role').eq('id', user.id).maybeSingle()
  if (!isOwnerRole((prof as { role?: string } | null)?.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const code = String((body as { code?: unknown }).code ?? '')
  const res = await verifyOwner2faCode(user.id, code)

  await svc.from('security_events').insert({
    user_id: user.id, email: user.email,
    event: res.ok ? `owner_2fa_passed_${res.via}` : `owner_2fa_failed_${res.reason}`,
    device_class: null, user_agent: null, ip: null,
  }).then(() => {}, () => {})

  if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason }, { status: 401 })

  const cookieVal = await mintOwner2faCookie(user.id, owner2faSecret(), COOKIE_TTL_MS)
  const store = await cookies()
  store.set(OWNER_2FA_COOKIE, cookieVal, {
    maxAge: COOKIE_TTL_MS / 1000, path: '/', httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  return NextResponse.json({ ok: true })
}
