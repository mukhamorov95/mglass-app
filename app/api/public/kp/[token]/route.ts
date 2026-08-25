import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { PUBLIC_QUOTE_COLS, toPublicQuote, parseNotes } from '@/lib/b2b/publicQuote'

// А5: публичное КП по токену. Логина нет — доступ даёт только сам токен, поэтому:
//   • наружу уходит только whitelist полей (toPublicQuote), без себестоимости;
//   • токен ищем точным сравнением по notes, ответ не кэшируем;
//   • клиент может согласовать или задать вопрос — это меняет статус просчёта.

export const dynamic = 'force-dynamic'

async function findByToken(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null
  const svc = createServiceClient()
  const { data } = await svc.from('b2b_orders')
    .select(PUBLIC_QUOTE_COLS)
    .ilike('notes', `%"public_token":"${token}"%`)
    .is('archived_at', null)
    .limit(2)
  const rows = (data ?? []) as unknown as Parameters<typeof toPublicQuote>[0][]
  // Строгая сверка: ilike ищет подстроку, решение принимаем по разобранному JSON.
  const match = rows.filter(r => parseNotes((r as { notes: string | null }).notes) .public_token === token)
  return match.length === 1 ? match[0] : null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const order = await findByToken(token)
  if (!order) return NextResponse.json({ error: 'Ссылка недействительна' }, { status: 404 })

  const svc = createServiceClient()
  const notes = parseNotes((order as { notes: string | null }).notes)
  if (!notes.public_opened_at) {
    await svc.from('b2b_orders')
      .update({ notes: JSON.stringify({ ...notes, public_opened_at: new Date().toISOString() }) })
      .eq('id', order.id)
  }

  return NextResponse.json({ quote: toPublicQuote(order) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const order = await findByToken(token)
  if (!order) return NextResponse.json({ error: 'Ссылка недействительна' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const action = body?.action === 'approve' ? 'approve' : body?.action === 'question' ? 'question' : null
  if (!action) return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
  const comment = typeof body?.comment === 'string' ? body.comment.slice(0, 1000).trim() || null : null

  const notes = parseNotes((order as { notes: string | null }).notes)
  const current = String(notes.status ?? 'quote')
  // Запущенный в работу заказ клиент уже не переигрывает — только оставляет вопрос.
  const launched = current === 'sent' || current === 'confirmed'

  const at = new Date().toISOString()
  const history = Array.isArray(notes.status_history) ? [...(notes.status_history as unknown[])] : []
  const next: Record<string, unknown> = {
    ...notes,
    client_response: { action, comment, at },
  }
  if (action === 'approve' && !launched) {
    next.status = 'agreed'
    next.status_comment = comment ?? 'Согласовано клиентом по ссылке'
    history.push({ from: current, to: 'agreed', at, by: 'client_link' })
    next.status_history = history
  }

  const svc = createServiceClient()
  const { error } = await svc.from('b2b_orders').update({ notes: JSON.stringify(next) }).eq('id', order.id)
  if (error) return NextResponse.json({ error: 'Не удалось сохранить' }, { status: 500 })

  return NextResponse.json({ ok: true, status: action === 'approve' && !launched ? 'agreed' : current })
}
