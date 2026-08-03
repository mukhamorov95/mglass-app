import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isOwnerRole } from '@/lib/getRole'
import { sendOwner2faCode } from '@/lib/owner2fa'

// Отправить код второго фактора владельцу в Telegram. Доступно только
// залогиненному owner-tier пользователю (сессия уже есть после ввода пароля —
// это ВТОРОЙ шаг). Код уходит на привязанный telegram_id, а не запросившему.
export async function POST() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const { data: prof } = await svc.from('users').select('role').eq('id', user.id).maybeSingle()
  if (!isOwnerRole((prof as { role?: string } | null)?.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const res = await sendOwner2faCode(user.id)
  await svc.from('security_events').insert({
    user_id: user.id, email: user.email, event: res.ok ? 'owner_2fa_sent' : `owner_2fa_send_${res.ok === false ? res.reason : 'fail'}`,
    device_class: null, user_agent: null, ip: null,
  }).then(() => {}, () => {})

  if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason }, { status: res.reason === 'throttled' ? 429 : 200 })
  return NextResponse.json({ ok: true })
}
