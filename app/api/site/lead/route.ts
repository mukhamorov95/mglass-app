import { NextRequest, NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'

// Публичный приём заявок с сайта Mglass (SEO). Путь в whitelist middleware.
// Заявка → crm_leads (source='site'), назначается на ВЛАДЕЛЬЦА: по RLS менеджеры
// её не видят, владелец обрабатывает первым (можно сменить позже на пул/бота).
// Антиспам: honeypot-поле + опциональный секрет (SITE_LEAD_SECRET) для серверной отправки.

// Владелец, на которого падают заявки с сайта (users.name). Настраивается env.
const OWNER = process.env.SITE_LEAD_OWNER || 'Администратор'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-site-secret',
}

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export function GET() {
  return NextResponse.json({ ok: true, intake: 'site' }, { headers: CORS })
}

export async function POST(req: NextRequest) {
  // Опциональный секрет: если задан в env — обязателен (для серверной отправки с сайта).
  const secret = process.env.SITE_LEAD_SECRET
  if (secret && req.headers.get('x-site-secret') !== secret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: CORS })
  }

  // Формы шлют по-разному: Tilda — form-urlencoded/multipart, код-форма — JSON.
  const ct = req.headers.get('content-type') || ''
  const body: Record<string, unknown> = {}
  if (ct.includes('application/json')) {
    Object.assign(body, ((await req.json().catch(() => null)) as Record<string, unknown>) ?? {})
  } else {
    const fd = await req.formData().catch(() => null)
    if (fd) for (const [k, val] of fd.entries()) body[k] = typeof val === 'string' ? val : ''
  }

  // Tilda при подключении вебхука шлёт тестовый пинг — отвечаем ok, лид не заводим.
  if (body.test != null && Object.keys(body).length <= 3) {
    return NextResponse.json({ ok: true, test: true }, { headers: CORS })
  }

  // Индекс по нижнему регистру: поля формы могут называться по-разному (Tilda/ручные).
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(body)) if (typeof v === 'string' && v.trim()) lower[k.toLowerCase()] = v.trim()
  const pick = (...keys: string[]) => { for (const k of keys) { const v = lower[k.toLowerCase()]; if (v) return v } return null }
  const clip = (s: string | null, n: number) => (s ? s.slice(0, n) : null)

  // Honeypot: скрытое поле, которое заполняют только боты — тихо отбрасываем.
  if (pick('hp')) return NextResponse.json({ ok: true }, { headers: CORS })

  const name = clip(pick('name', 'имя', 'fio', 'фио', 'firstname'), 200)
  const phone = clip(pick('phone', 'телефон', 'tel', 'phone-number'), 50)
  const email = clip(pick('email', 'почта', 'e-mail'), 200)
  const message = clip(pick('message', 'comment', 'text', 'сообщение', 'комментарий', 'вопрос', 'textarea'), 2000)
  const product = clip(pick('product', 'продукт', 'изделие', 'услуга'), 200)
  const sizes = clip(pick('sizes', 'размеры', 'размер'), 200)
  const city = clip(pick('city', 'город'), 200)
  const budget = clip(pick('budget', 'бюджет'), 200)
  const page = clip(pick('page', 'url') ?? req.headers.get('referer'), 500)
  const utmPairs = Object.entries(lower).filter(([k]) => k.startsWith('utm')).map(([k, v]) => `${k}=${v}`)
  const utm = utmPairs.length ? utmPairs.join(' ').slice(0, 500) : null

  // Пустышки не заводим — нужен хоть какой-то способ связи или суть запроса.
  if (!phone && !name && !message) {
    return NextResponse.json({ error: 'нужен телефон, имя или сообщение' }, { status: 400, headers: CORS })
  }

  const service = db()
  const noteParts = [message, product && `Продукт: ${product}`, sizes && `Размеры: ${sizes}`, email && `Email: ${email}`, page && `Страница: ${page}`, utm && `UTM: ${utm}`].filter(Boolean)
  const { data: created, error } = await service.from('crm_leads').insert({
    source: 'site', name, phone, city, product, sizes, budget,
    manager: OWNER, stage: 'Получена новая заявка',
    note: noteParts.join('\n') || null,
  }).select('id').maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS })
  const leadId = (created as { id: number } | null)?.id

  if (leadId) {
    await service.from('crm_lead_events').insert([
      { lead_id: leadId, kind: 'system', text: 'Заявка создана с сайта Mglass', author: 'Сайт' },
      ...(message ? [{ lead_id: leadId, kind: 'message', text: `КЛИЕНТ: ${message}`, author: null }] : []),
    ])
    await notifyAdmins([
      '🌐 <b>Новая заявка с сайта Mglass</b>',
      [name, phone].filter(Boolean).join(' · '),
      [product, sizes, city].filter(Boolean).join(' · '),
      message ? `«${message.slice(0, 300)}»` : '',
      page ? `Страница: ${page}` : '',
      '',
      `Карточка: https://mglass-app.vercel.app/crm/${leadId}`,
    ].filter(Boolean).join('\n')).catch(() => {})
  }

  return NextResponse.json({ ok: true, id: leadId }, { headers: CORS })
}
