import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

const ALLOWED_KEYS = ['revenue', 'analyst', 'production', 'catalog']

export async function POST(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params
  if (!ALLOWED_KEYS.includes(key)) {
    return NextResponse.json({ error: 'Unknown agent' }, { status: 404 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Строим baseUrl: для localhost используем http, для прода — https
  const host = req.headers.get('host') ?? 'localhost:3000'
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1')
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${isLocal ? 'http' : 'https'}://${host}`

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
