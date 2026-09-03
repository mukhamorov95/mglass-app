import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { sendMessage } from '@/lib/telegram'
import { withCors, corsPreflight } from '@/lib/configurator/cors'

// Заявка с публичного сайта. Путь /api/configurator/ уже открыт в middleware —
// поэтому форма на стороннем домене может сюда постучаться без авторизации.
//
// Два адресата намеренно: строка в базе (чтобы лид не пропал, если Telegram лёг)
// и сообщение владельцу (чтобы его кто-то увидел сегодня, а не при разборе базы).
// Лид, который лежит только в таблице, повторяет ошибку с чертежами в цехе:
// данные есть, до человека не доходят.

const LIMIT_PER_HOUR = 12
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now(), hourAgo = now - 3_600_000
  const list = (hits.get(ip) ?? []).filter(t => t > hourAgo)
  if (list.length >= LIMIT_PER_HOUR) { hits.set(ip, list); return true }
  list.push(now); hits.set(ip, list)
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some(t => t > hourAgo)) hits.delete(k)
  return false
}

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

// Телефон принимаем как введён, но проверяем, что цифр достаточно: иначе форму
// заполняет бот, а менеджер тратит время на «звонок» по строке из букв.
const digits = (s: string) => (s.match(/\d/g) ?? []).length

async function notifyOwners(text: string) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return
  try {
    const svc = createServiceClient()
    const { data: owners } = await svc.from('users').select('id').in('role', ['admin', 'ceo']).eq('active', true)
    const ids = (owners ?? []).map(o => (o as { id: string }).id)
    if (!ids.length) return
    const { data: links } = await svc.from('telegram_users').select('telegram_id').in('user_id', ids)
    const chats = new Set((links ?? []).map(l => (l as { telegram_id?: number }).telegram_id).filter((n): n is number => typeof n === 'number'))
    await Promise.allSettled([...chats].map(chat => sendMessage(chat, text)))
  } catch { /* уведомление никогда не роняет приём заявки */ }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (rateLimited(ip)) {
    return withCors({ error: 'Слишком много заявок. Попробуйте позже.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const phone = clean(body?.phone, 32)
  if (digits(phone) < 10) {
    return withCors({ error: 'Нужен телефон' }, { status: 400 })
  }
  const name = clean(body?.name, 120)
  const comment = clean(body?.comment, 600)
  const context = clean(body?.context, 160)
  const source = clean(body?.source, 40) || 'site'

  try {
    const svc = createServiceClient()
    await svc.from('site_leads').insert({ name, phone, comment, context, source, ip })
  } catch {
    // База недоступна — заявку всё равно доставим сообщением, а не потеряем.
  }

  await notifyOwners(
    [
      '🔔 Заявка с сайта',
      name ? `Имя: ${name}` : null,
      `Телефон: ${phone}`,
      context ? `Страница: ${context}` : null,
      comment ? `Комментарий: ${comment}` : null,
    ].filter(Boolean).join('\n')
  )

  return withCors({ ok: true })
}

// Форма живёт на другом домене — браузер шлёт предварительный запрос.
export async function OPTIONS() { return corsPreflight() }
