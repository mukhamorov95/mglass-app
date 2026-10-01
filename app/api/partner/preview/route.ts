import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { PREVIEW_COOKIE, PREVIEW_MAX_AGE, previewClientId } from '@/lib/partnerPreview'

// «Смотреть как партнёр»: включить (POST {clientId}), узнать текущий (GET), выйти (DELETE).
// Только владелец. Кука — лишь id клиента; уважает её lib/partnerPreview, снова проверяя роль.

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ preview: null })
  const svc = createServiceClient()
  const id = await previewClientId(svc, user.id)
  if (id == null) return NextResponse.json({ preview: null })
  const { data } = await svc.from('b2b_clients').select('id,name,is_test').eq('id', id).maybeSingle()
  return NextResponse.json({ preview: data ?? null })
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => ({})) as { clientId?: unknown }
  const clientId = Number(body.clientId)
  if (!Number.isInteger(clientId) || clientId <= 0) return NextResponse.json({ error: 'Не выбран клиент' }, { status: 400 })
  const svc = createServiceClient()
  const { data, error } = await svc.from('b2b_clients').select('id,name').eq('id', clientId).maybeSingle()
  if (error) return NextResponse.json({ error: `Клиент не прочитан: ${error.message}` }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Клиент не найден' }, { status: 404 })
  const res = NextResponse.json({ ok: true, client: data })
  res.cookies.set(PREVIEW_COOKIE, String(clientId), { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: PREVIEW_MAX_AGE })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(PREVIEW_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 0 })
  return res
}
