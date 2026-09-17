import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'

const ALLOWED_KEYS = ['revenue', 'analyst', 'production', 'catalog']

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params
  if (!ALLOWED_KEYS.includes(key)) {
    return NextResponse.json({ error: 'Unknown agent' }, { status: 404 })
  }

  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  // Адрес — только из настроек, не из заголовка Host: иначе поддельный Host увёл бы
  // запрос вместе с CRON_SECRET на чужой сервер.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
    ?? (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : null)
  if (!baseUrl) return NextResponse.json({ ok: false, error: 'Не задан адрес приложения (NEXT_PUBLIC_APP_URL)' }, { status: 500 })

  let res: Response
  try {
    res = await fetch(`${baseUrl}/api/cron/agent-${key}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
        'Content-Type': 'application/json',
      },
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }

  const text = await res.text()
  try {
    const data = JSON.parse(text)
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ ok: false, error: text || 'Empty response' }, { status: 500 })
  }
}
