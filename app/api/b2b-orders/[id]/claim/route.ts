import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { parseNotes } from '@/lib/b2b/publicQuote'
import { notifyOrderManager } from '@/lib/b2b/notifyManager'

// А17: рекламация по заказу. Живёт в notes.claim — отдельная таблица не нужна,
// рекламация это состояние заказа, а не самостоятельный документ.
// Себестоимость переделки записываем руками: автоматически её взять неоткуда,
// а без неё брак не виден ни в марже, ни в статистике.

const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'production'] as const

const REASONS = ['бой', 'размер', 'обработка', 'закалка', 'комплектность', 'сроки', 'другое'] as const

export type Claim = {
  status: 'open' | 'resolved'
  reason: string
  comment: string | null
  cost: number            // себестоимость переделки, ₽ (0 = ещё не посчитана)
  fault: 'production' | 'manager' | 'supplier' | 'client' | 'unknown'
  opened_at: string
  opened_by: string | null
  resolved_at?: string | null
  resolution?: string | null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const orderId = Number(id)
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const action = body?.action === 'close' ? 'close' : 'open'
  const reason = REASONS.includes(body?.reason) ? String(body.reason) : 'другое'
  const fault = ['production', 'manager', 'supplier', 'client', 'unknown'].includes(body?.fault) ? body.fault : 'unknown'
  const comment = typeof body?.comment === 'string' ? body.comment.slice(0, 1000).trim() || null : null
  const cost = Math.max(0, Math.round(Number(body?.cost) || 0))

  const sb = await createServerClient()
  const { data: order } = await sb.from('b2b_orders').select('id, custom_number, client_name, notes').eq('id', orderId).maybeSingle()
  if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const { data: { user } } = await sb.auth.getUser()
  let name: string | null = null
  if (user?.id) {
    const { data: prof } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
    name = (prof?.name as string | null) ?? user.email ?? null
  }

  const notes = parseNotes(order.notes as string | null)
  const prev = notes.claim as Claim | undefined
  const now = new Date().toISOString()

  const claim: Claim = action === 'close'
    ? {
        ...(prev ?? { status: 'open', reason, comment, cost, fault, opened_at: now, opened_by: name }),
        status: 'resolved',
        cost: cost || prev?.cost || 0,
        resolved_at: now,
        resolution: comment ?? prev?.resolution ?? null,
      }
    : {
        status: 'open', reason, comment, cost, fault,
        opened_at: prev?.opened_at ?? now,
        opened_by: prev?.opened_by ?? name,
      }

  const history = Array.isArray(notes.claim_history) ? [...(notes.claim_history as unknown[])] : []
  history.push({ ...claim, at: now, by: name })

  const { error } = await sb.from('b2b_orders').update({
    notes: JSON.stringify({ ...notes, claim, claim_history: history }),
    updated_by_user_id: user?.id ?? null,
    updated_by_name: name,
    updated_at: now,
  }).eq('id', orderId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const num = (order.custom_number as string | null)?.trim() || `#${orderId}`
  await notifyOrderManager(
    orderId,
    action === 'close'
      ? `✅ Рекламация закрыта по заказу <b>${num}</b>${cost > 0 ? ` · переделка ${cost.toLocaleString('ru-RU')} ₽` : ''}`
      : `⚠️ Рекламация по заказу <b>${num}</b> · ${reason}${comment ? `\n${comment}` : ''}`,
    '/b2b-orders',
  )

  return NextResponse.json({ ok: true, claim })
}
