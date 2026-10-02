import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { sendMessage, type InlineKeyboard } from '@/lib/telegram'
import { withCors, corsPreflight } from '@/lib/configurator/cors'
import { parseLead } from '@/lib/configurator/leadPayload'
import { dealForLead } from '@/lib/configurator/leadDeal'
import { appUrl } from '@/lib/appUrl'

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

async function notifyOwners(text: string, keyboard?: InlineKeyboard) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return
  try {
    const svc = createServiceClient()
    const { data: owners } = await svc.from('users').select('id').in('role', ['admin', 'ceo']).eq('active', true)
    const ids = (owners ?? []).map(o => (o as { id: string }).id)
    if (!ids.length) return
    const { data: links } = await svc.from('telegram_users').select('telegram_id').in('user_id', ids)
    const chats = new Set((links ?? []).map(l => (l as { telegram_id?: number }).telegram_id).filter((n): n is number => typeof n === 'number'))
    await Promise.allSettled([...chats].map(chat => sendMessage(chat, text, keyboard)))
  } catch { /* уведомление никогда не роняет приём заявки */ }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (rateLimited(ip)) {
    return withCors({ error: 'Слишком много заявок. Попробуйте позже.' }, { status: 429 })
  }

  const parsed = parseLead(await req.json().catch(() => null))
  if (parsed.kind === 'bot') return withCors({ ok: true })
  if (parsed.kind === 'invalid') return withCors({ error: parsed.error }, { status: 400 })

  let leadId: number | null = null
  let deal: { dealId: number; created: boolean } | null = null
  try {
    const svc = createServiceClient()
    // Supabase не бросает исключение на ошибку вставки, а возвращает её —
    // без этой проверки заявка терялась бы из базы молча. Телефон в лог не пишем.
    const { data, error } = await svc.from('site_leads').insert({ ...parsed.row, ip, config: parsed.config }).select('id').single()
    if (error) console.error('[configurator/lead] site_leads insert:', error.message)
    else leadId = Number(data.id)
    // Ш3: заявка 3D-конструктора со составом заводит сделку у нас (решение 11, 02.10).
    // Остальные формы сайта сделку не заводят — о них решения не было.
    if (parsed.config && leadId) {
      deal = await dealForLead(svc, parsed.row)
      if (deal) {
        const { error: linkErr } = await svc.from('site_leads').update({ deal_id: deal.dealId }).eq('id', leadId).select('id')
        if (linkErr) console.error('[configurator/lead] site_leads link:', linkErr.message)
      }
    }
  } catch {
    // База недоступна — заявку всё равно доставим сообщением, а не потеряем.
  }

  const keyboard: InlineKeyboard = []
  if (parsed.config && leadId) keyboard.push([{ text: 'Открыть расчёт', url: appUrl(`/calculator/build?lead=${leadId}`) }])
  if (deal) keyboard.push([{ text: deal.created ? `Сделка №${deal.dealId}` : `Сделка №${deal.dealId} (клиент уже был)`, url: appUrl(`/deal/${deal.dealId}`) }])
  await notifyOwners(parsed.message, keyboard.length ? keyboard : undefined)

  return withCors({ ok: true })
}

// Форма живёт на другом домене — браузер шлёт предварительный запрос.
export async function OPTIONS() { return corsPreflight() }
