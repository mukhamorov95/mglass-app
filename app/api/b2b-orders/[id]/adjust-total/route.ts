import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { rescaleItemsToTotal } from '@/lib/b2b/adjustTotal'
import { appendTo, parseOrderNotes } from '@/lib/b2b/orderNotes'
import { syncInvoicesForOrders } from '@/lib/money/invoiceSync'

// Владелец меняет итоговую сумму уже запущенного B2B-заказа — в ЛЮБУЮ сторону.
// Изначально разрешалось только вниз (сценарий скидки), но заказ продаётся и дороже
// просчёта: доп.работы, пересогласование. Запрет на подъём означал, что заказ навсегда
// остаётся с суммой, за которую его НЕ продали, и реестр продаж врёт.
// Пересчитываем цены всех позиций пропорционально: saleIncVat × factor, затем НДС
// (saleExVat/outputVat) и маржа заново по неизменной себестоимости. Дрейф округления
// поглощает последняя позиция, чтобы Σ = новой сумме (КП/счёт бьются копейка-в-копейку).
// Скидку сворачиваем в цены позиций (discount_percent=0), иначе КП/счёт задвоят её.
// Если заказ уже оплачен (есть строка crm_sales) — обновляем сумму в реестре продаж.
// Неоплаченный счёт с этим заказом следует за суммой (lib/money/invoiceSync).

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
  if (nt === oldTotal) return NextResponse.json({ error: `Сумма не изменилась (${oldTotal.toLocaleString('ru-RU')} ₽)` }, { status: 400 })

  const items = Array.isArray(order.items) ? (order.items as Record<string, unknown>[]) : []
  if (items.length === 0) return NextResponse.json({ error: 'В заказе нет позиций' }, { status: 400 })

  const rescaled = rescaleItemsToTotal(items, oldTotal, nt, Number(order.discount_percent) || 0)

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
  // Историю дописываем к свежей записи: между чтением в начале и этой строкой — ожидания.
  const { data: fresh, error: freshErr } = await svc.from('b2b_orders').select('notes').eq('id', orderId).maybeSingle()
  const entry = { old_total: oldTotal, new_total: nt, changed_by: actor, changed_at: new Date().toISOString() }
  const { error: notesErr } = freshErr || !fresh
    ? { error: freshErr ?? { message: 'нет строки' } }
    : await svc.rpc('patch_order_notes_shallow', { p_order_id: orderId, p_patch: {
        total_history: appendTo(parseOrderNotes((fresh as { notes: unknown }).notes), 'total_history', entry),
      } })
  if (notesErr) return NextResponse.json({ error: `Сумма изменена, история — нет: ${notesErr.message}` }, { status: 500 })

  // Реестр продаж: если заказ оплачен — обновляем сумму (sale_date НЕ трогаем).
  const { data: sale } = await svc.from('crm_sales').select('id').eq('b2b_order_id', orderId).maybeSingle()
  if (sale) {
    await svc.from('crm_sales').update({ amount: nt, updated_at: new Date().toISOString() }).eq('b2b_order_id', orderId)
  }

  // Сумма уже изменена — сбой счёта не откатывает её, а говорится словами.
  let invoices: Awaited<ReturnType<typeof syncInvoicesForOrders>> | null = null
  let invoiceWarning: string | null = null
  try { invoices = await syncInvoicesForOrders(svc, [orderId]) } catch (e) {
    invoiceWarning = `Сумма заказа изменена, счёт — нет: ${e instanceof Error ? e.message : String(e)}`
  }

  return NextResponse.json({
    ok: true, newTotal: nt, ledgerSynced: !!sale,
    invoicesUpdated: invoices?.updated ?? [], invoicesPaid: invoices?.paidSkipped ?? [], invoiceWarning,
  })
}
