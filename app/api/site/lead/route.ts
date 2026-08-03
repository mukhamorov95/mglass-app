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

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'bad json' }, { status: 400, headers: CORS })

  // Honeypot: скрытое поле, которое заполняют только боты — тихо отбрасываем.
  if (typeof body.hp === 'string' && body.hp.trim()) return NextResponse.json({ ok: true }, { headers: CORS })

  const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const name = str(body.name, 200)
  const phone = str(body.phone, 50)
  const message = str(body.message ?? body.comment ?? body.text, 2000)
  const product = str(body.product, 200)
  const sizes = str(body.sizes, 200)
  const city = str(body.city, 200)
  const budget = str(body.budget, 200)
  const page = str(body.page ?? body.url, 500)
  const utm = str(typeof body.utm === 'object' ? JSON.stringify(body.utm) : body.utm, 500)

  // Пустышки не заводим — нужен хоть какой-то способ связи или суть запроса.
  if (!phone && !name && !message) {
    return NextResponse.json({ error: 'нужен телефон, имя или сообщение' }, { status: 400, headers: CORS })
  }

  const service = db()
  const noteParts = [message, product && `Продукт: ${product}`, sizes && `Размеры: ${sizes}`, page && `Страница: ${page}`, utm && `UTM: ${utm}`].filter(Boolean)
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
