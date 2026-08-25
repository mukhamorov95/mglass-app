import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient as createServerClient } from '@/lib/supabase-server'
import type { B2BOrderItem } from '@/lib/b2bCalculator'
import {
  distributeTargetTotal, clearAutoOverride, orderMarginPercent,
  MIN_MARGIN_PERCENT, type OverrideMeta, type PriceApproval,
} from '@/lib/b2b/priceOverride'

// Ручная корректировка итоговой суммы ПРОСЧЁТА (до запуска в работу).
// POST { newTotal } — раскидать сумму по позициям и зафиксировать скидку.
// DELETE          — снять корректировку, вернуть прайс.
//
// Читаем/пишем под пользователем (анон-ключ + куки) — изоляция менеджеров держится
// на RLS, как и в остальных мутациях списка просчётов. Запущенные заказы сюда не
// пускаем: у них своя ручка /api/b2b-orders/[id]/adjust-total (только владелец).

const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'buyer'] as const

type OrderRow = {
  id: number
  items: B2BOrderItem[] | null
  discount_percent: number | null
  total_sale_inc_vat: number | null
  total_after_discount: number | null
  notes: string | null
}

const COLS = 'id, items, discount_percent, total_sale_inc_vat, total_after_discount, notes'

function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (p && typeof p === 'object') return p as Record<string, unknown> } catch {}
  return {}
}

function isLaunched(notes: Record<string, unknown>): boolean {
  const st = String(notes.status ?? '')
  return st === 'sent' || st === 'confirmed'
}

async function loadContext(id: string) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return { error: guard }

  const orderId = Number(id)
  if (!Number.isFinite(orderId)) {
    return { error: NextResponse.json({ error: 'Некорректный id' }, { status: 400 }) }
  }

  const sb = await createServerClient()
  const { data, error } = await sb.from('b2b_orders').select(COLS).eq('id', orderId).maybeSingle()
  if (error || !data) return { error: NextResponse.json({ error: 'Просчёт не найден' }, { status: 404 }) }

  const order = data as unknown as OrderRow
  const notes = parseNotes(order.notes)
  if (isLaunched(notes)) {
    return { error: NextResponse.json({ error: 'Заказ уже запущен в работу — правьте сумму в разделе «Заказы»' }, { status: 409 }) }
  }

  const { data: { user } } = await sb.auth.getUser()
  let actorName: string | null = null
  if (user?.id) {
    const { data: prof } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
    actorName = (prof?.name as string | null) ?? user.email ?? null
  }

  return { sb, orderId, order, notes, userId: user?.id ?? null, actorName }
}

function updateMeta(userId: string | null, actorName: string | null) {
  return {
    updated_by_user_id: userId,
    updated_by_name:    actorName,
    updated_at:         new Date().toISOString(),
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await loadContext(id)
  if ('error' in ctx) return ctx.error
  const { sb, orderId, order, notes, userId, actorName } = ctx

  const body = await req.json().catch(() => ({}))
  const target = Math.round(Number(body?.newTotal))
  if (!Number.isFinite(target) || target <= 0) {
    return NextResponse.json({ error: 'Некорректная сумма' }, { status: 400 })
  }

  const items = Array.isArray(order.items) ? order.items : []
  const res = distributeTargetTotal(items, target)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })

  const oldTotal = Number(order.total_after_discount) || Number(order.total_sale_inc_vat) || 0
  const marginPercent = orderMarginPercent(res.items, res.discountPercent)

  const override: OverrideMeta = {
    target:           res.appliedTotal,
    base:             res.base + res.fixedSum,
    factor:           res.factor,
    discount_percent: res.discountPercent,
    at:               new Date().toISOString(),
    by:               userId,
    by_name:          actorName,
  }
  const history = Array.isArray(notes.total_history) ? [...(notes.total_history as unknown[])] : []
  history.push({
    old_total: oldTotal, new_total: res.appliedTotal,
    discount_percent: res.discountPercent, markup_percent: res.markupPercent,
    changed_by: actorName, changed_by_id: userId, changed_at: override.at, source: 'quote_list',
  })
  // А11: тонкая маржа не блокирует цену, но ставит её на согласование владельцу.
  // Пока не согласовано — просчёт виден владельцу в отдельной вкладке, у менеджера
  // горит бейдж. Ушли выше порога — заявка снимается сама.
  const approval: PriceApproval | undefined = marginPercent < MIN_MARGIN_PERCENT
    ? {
        needed: true, margin: marginPercent, total: res.appliedTotal,
        by: userId, by_name: actorName, at: override.at, resolution: null,
      }
    : undefined

  const newNotes = JSON.stringify({
    ...notes,
    price_override: override,
    total_history: history,
    price_approval: approval,
  })

  const { error } = await sb.from('b2b_orders').update({
    items:                res.items,
    discount_percent:     res.discountPercent,
    total_after_discount: res.appliedTotal,
    margin_percent:       marginPercent,
    notes:                newNotes,
    ...updateMeta(userId, actorName),
  }).eq('id', orderId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    newTotal:        res.appliedTotal,
    discountPercent: res.discountPercent,
    markupPercent:   res.markupPercent,
    marginPercent,
    needsApproval:   !!approval,
    items:           res.items,
    notes:           newNotes,
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await loadContext(id)
  if ('error' in ctx) return ctx.error
  const { sb, orderId, order, notes, userId, actorName } = ctx

  const items = clearAutoOverride(Array.isArray(order.items) ? order.items : [])
  // Возврат к прайсу: скидка обнуляется вместе с корректировкой, договорные позиции остаются.
  const restored = items.reduce((s, it) => s + (it.manualTotal ?? Math.round(Number(it.saleIncVat) || 0)), 0)
  const marginPercent = orderMarginPercent(items, 0)

  const rest = { ...notes }
  delete rest.price_override
  delete rest.price_approval
  const history = Array.isArray(notes.total_history) ? [...(notes.total_history as unknown[])] : []
  history.push({
    old_total: Number(order.total_after_discount) || 0, new_total: restored,
    reset: true, changed_by: actorName, changed_by_id: userId,
    changed_at: new Date().toISOString(), source: 'quote_list',
  })
  const newNotes = JSON.stringify({ ...rest, total_history: history })

  const { error } = await sb.from('b2b_orders').update({
    items,
    discount_percent:     0,
    total_after_discount: restored,
    margin_percent:       marginPercent,
    notes:                newNotes,
    ...updateMeta(userId, actorName),
  }).eq('id', orderId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, newTotal: restored, discountPercent: 0, marginPercent, items, notes: newNotes })
}
