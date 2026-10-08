import { NextRequest, NextResponse, after } from 'next/server'
import { boardGate } from '@/lib/shopBoard/auth'
import { actOnCard, commentCard, editCard } from '@/lib/shopBoard/server'
import { ACTION_EVENT, parseCardEdit, type CardAction } from '@/lib/shopBoard/model'
import { notifyBoard } from '@/lib/shopBoard/notify'

const ACTIONS = new Set<CardAction>(['take', 'done', 'reopen', 'close'])

// Действие с поручением: { action: take|done|reopen|close }, { comment: '…' } или { edit: { hot?, due_at? } }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await boardGate()
  if (gate instanceof NextResponse) return gate
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Нет такого поручения' }, { status: 400 })
  const body = (await req.json().catch(() => null)) as { action?: unknown; comment?: unknown; edit?: unknown } | null

  if (body?.edit !== undefined) {
    const edit = parseCardEdit(body.edit)
    if ('error' in edit) return NextResponse.json({ error: edit.error }, { status: 400 })
    const r = await editCard(gate.svc, id, edit, gate.actor)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    after(() => notifyBoard(gate.svc, 'edited', r.value.card, gate.actor, r.value.summary))
    return NextResponse.json({ ok: true, card: r.value.card, summary: r.value.summary })
  }

  if (typeof body?.comment === 'string') {
    const r = await commentCard(gate.svc, id, body.comment, gate.actor)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    const text = body.comment.trim()
    after(() => notifyBoard(gate.svc, 'comment', r.value, gate.actor, text))
    return NextResponse.json({ ok: true })
  }

  const action = body?.action as CardAction
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
  const r = await actOnCard(gate.svc, id, action, gate.actor)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  after(() => notifyBoard(gate.svc, ACTION_EVENT[action], r.value.card, gate.actor))
  return NextResponse.json({ ok: true, card: r.value.card })
}
