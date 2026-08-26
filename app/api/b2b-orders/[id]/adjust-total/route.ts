import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { createClient as createServerClient } from '@/lib/supabase-server'

// Владелец меняет итоговую сумму уже запущенного B2B-заказа (только вниз — скидка).
// Пересчитываем цены всех позиций пропорционально: saleIncVat × factor, затем НДС
// (saleExVat/outputVat) и маржа заново по неизменной себестоимости. Дрейф округления
// поглощает последняя позиция, чтобы Σ = новой сумме (КП/счёт бьются копейка-в-копейку).
// Скидку сворачиваем в цены позиций (discount_percent=0), иначе КП/счёт задвоят её.
// Если заказ уже оплачен (есть строка crm_sales) — обновляем сумму в реестре продаж.

const VAT = 22 // как в lib/b2bCalculator

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const orderId = Number(id)
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const nt = Math.round(Number(body?.newTotal))
  if (!Number.isFinite(nt) || nt <= 0) return NextResponse.json({ error: 'Некорректная сумма' }, { status: 400 })

  const svc = createServiceClient()
  const { data: order, error } = await svc.from('b2b_orders')
    .select('id, items, total_sale_inc_vat, total_after_discount, discount_percent, notes')
    .eq('id', orderId).single()
  if (error || !order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const oldTotal = Math.round(Number(order.total_after_discount || order.total_sale_inc_vat || 0))
  if (oldTotal <= 0) return NextResponse.json({ error: 'У заказа нет суммы' }, { status: 400 })
  if (nt >= oldTotal) return NextResponse.json({ error: `Новая сумма должна быть меньше текущей (${oldTotal.toLocaleString('ru-RU')} ₽)` }, { status: 400 })

  const items = Array.isArray(order.items) ? (order.items as Record<string, unknown>[]) : []
  if (items.length === 0) return NextResponse.json({ error: 'В заказе нет позиций' }, { status: 400 })

  const factor = nt / oldTotal
  let running = 0
  const rescaled = items.map((it, idx) => {
    const oldInc = Math.round(Number(it.saleIncVat) || 0)
    const newInc = idx === items.length - 1 ? nt - running : Math.round(oldInc * factor)
    if (idx !== items.length - 1) running += newInc
    const saleExVat = Math.round(newInc * 100 / (100 + VAT))
    const outputVat = newInc - saleExVat
    const costExVat = Number(it.costExVat) || 0
    const margin = saleExVat > 0 ? Math.round((1 - costExVat / saleExVat) * 100) : 0
    return { ...it, saleIncVat: newInc, saleExVat, outputVat, manualTotal: newInc, margin }
  })

  // actor name для истории
  let actor: string | null = null
  try {
    const server = await createServerClient()
    const { data: { user } } = await server.auth.getUser()
    if (user?.id) {
      const { data: prof } = await server.from('users').select('name').eq('id', user.id).maybeSingle()
      actor = (prof?.name as string) || user.email || null
    }
  } catch {}

  let notes: Record<string, unknown> = {}
  try { notes = order.notes ? JSON.parse(order.notes as string) : {} } catch {}
  const history = Array.isArray(notes.total_history) ? notes.total_history : []
  history.push({ old_total: oldTotal, new_total: nt, changed_by: actor, changed_at: new Date().toISOString() })
  notes.total_history = history

  // Колонки пишем прямо, notes — точечным патчем (только свой ключ total_history),
  // чтобы не затереть чужие ключи (оплата, доставка, этапы), попавшие в notes
  // между нашим чтением и записью. Правило: контур патчит только свои ключи.
  const { error: upErr } = await svc.from('b2b_orders').update({
    items: rescaled,
    total_sale_inc_vat: nt,
    total_after_discount: nt,
    discount_percent: 0,
    updated_at: new Date().toISOString(),
  }).eq('id', orderId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  await svc.rpc('patch_order_notes_shallow', { p_order_id: orderId, p_patch: { total_history: history } })

  // Реестр продаж: если заказ оплачен — обновляем сумму (sale_date НЕ трогаем).
  const { data: sale } = await svc.from('crm_sales').select('id').eq('b2b_order_id', orderId).maybeSingle()
  if (sale) {
    await svc.from('crm_sales').update({ amount: nt, updated_at: new Date().toISOString() }).eq('b2b_order_id', orderId)
  }

  return NextResponse.json({ ok: true, newTotal: nt, ledgerSynced: !!sale })
}
