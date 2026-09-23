import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { mskDay } from '@/lib/amoActivity'
import { sendMessage, notifyAdmins } from '@/lib/telegram'
import { telegramDigest } from '@/lib/coaching/digest'
import type { Coaching } from '@/lib/coaching/rules'

// Утреннее напоминание «открой Мой день» тем, кто привязал бота.
// Крон не авторизован middleware — проверяет свой секрет сам.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const sb = createServiceClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mglass-app.vercel.app'

  const [{ data: snaps, error }, { data: links }] = await Promise.all([
    sb.from('manager_coaching').select('amo_user_id, name, computed_at, payload').gt('amo_user_id', 0),
    sb.from('telegram_users').select('telegram_id, users!inner(amo_user_id)'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const chatByAmo = new Map<number, number>()
  for (const l of (links ?? []) as { telegram_id: number; users: { amo_user_id: number | null } | { amo_user_id: number | null }[] }[]) {
    const u = Array.isArray(l.users) ? l.users[0] : l.users
    if (u?.amo_user_id) chatByAmo.set(Number(u.amo_user_id), Number(l.telegram_id))
  }

  const today = mskDay(Math.floor(Date.now() / 1000))
  const fresh = (snaps ?? []).filter(s => mskDay(Math.floor(new Date(s.computed_at).getTime() / 1000)) === today)
  const sent: string[] = []
  const noLink: string[] = []
  for (const s of fresh) {
    const chat = chatByAmo.get(Number(s.amo_user_id))
    if (!chat) { noLink.push(String(s.name)); continue }
    const text = telegramDigest(s.payload as Coaching, appUrl)
    if (!text) continue
    const r = await sendMessage(chat, text) as { ok?: boolean; description?: string } | undefined
    if (r?.ok) sent.push(String(s.name))
    else console.error('[cron/coaching-telegram] не доставлено', s.name, r?.description)
  }

  // Молчание без объяснения выглядит как «работает»: если бота не привязал никто,
  // владелец должен узнать об этом, а не гадать.
  if (sent.length === 0 && noLink.length > 0) {
    await notifyAdmins(`«Мой день» некому отправить: бот не привязан у ${noLink.join(', ')}.\nПривязка: Админ → Пользователи → кнопка TG, код отправить боту.`)
  }
  return NextResponse.json({ ok: true, sent, noLink })
}
