import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { newPublicToken, parseNotes } from '@/lib/b2b/publicQuote'

// А2: ссылка на КП для клиента. POST — выдать (или переиспользовать) ссылку,
// DELETE — отозвать. Токен лежит в notes.public_token; отзыв просто стирает его.

const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'buyer'] as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const orderId = Number(id)
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const sb = await createServerClient()
  const { data: order, error } = await sb.from('b2b_orders')
    .select('id, notes').eq('id', orderId).maybeSingle()
  if (error || !order) return NextResponse.json({ error: 'Просчёт не найден' }, { status: 404 })

  const notes = parseNotes(order.notes as string | null)
  const body  = await req.json().catch(() => ({}))
  const token = (!body?.rotate && typeof notes.public_token === 'string' && notes.public_token)
    ? notes.public_token as string
    : newPublicToken()

  if (token !== notes.public_token) {
    const { data: { user } } = await sb.auth.getUser()
    const shares = Array.isArray(notes.share_log) ? [...(notes.share_log as unknown[])] : []
    shares.push({ at: new Date().toISOString(), by: user?.id ?? null, action: notes.public_token ? 'rotate' : 'create' })
    const newNotes = JSON.stringify({ ...notes, public_token: token, share_log: shares })
    const { error: upErr } = await sb.from('b2b_orders').update({ notes: newNotes }).eq('id', orderId)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  const origin = req.nextUrl.origin
  return NextResponse.json({ ok: true, token, url: `${origin}/p/kp/${token}` })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const orderId = Number(id)
  const sb = await createServerClient()
  const { data: order } = await sb.from('b2b_orders').select('id, notes').eq('id', orderId).maybeSingle()
  if (!order) return NextResponse.json({ error: 'Просчёт не найден' }, { status: 404 })

  const notes = parseNotes(order.notes as string | null)
  delete notes.public_token
  const { error } = await sb.from('b2b_orders').update({ notes: JSON.stringify(notes) }).eq('id', orderId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
