import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { recordPayment, voidPayment } from '@/lib/payments/recordPayment'
import { b2bPaymentKey } from '@/lib/payments/paymentKeys'
import { upsertSaleFromB2B, voidSale } from '@/lib/salesLedger'
import { notifyOrderManager } from '@/lib/b2b/notifyManager'
import { finalTotalOf } from '@/lib/b2b/priceOverride'
import { loadOrderPaid, settlementAmount } from '@/lib/money/orderPaid'

// Д2: ЕДИНСТВЕННЫЙ писатель оплаты B2B-заказа. Все три экрана (просчёты,
// заказы, дебиторка CFO) ходят сюда — прямых update из браузера больше нет.
// Один вызов делает три вещи и не расходится:
//   1) notes (legacy, на нём живут старые экраны и бейджи)
//   2) payments — денежное ядро, ключ по бизнес-документу (идемпотентно)
//   3) crm_sales — ведомость продаж, needs_review=true (менеджер дозаполнит)
// Снятие оплаты не удаляет ничего: payments → voided_at, crm_sales → voided.
// «Оплачен» дописывает только остаток: итог − то, что уже пришло в payments (выписка,
// счёт, предоплата). Уже покрыто — платёж не пишется, иначе деньги задваиваются.

type Body = { status: 'unpaid' | 'partial' | 'paid'; amount?: number; method?: string; paidAt?: string }
type Notes = Record<string, unknown> & {
  payment_status?: string
  prepayment_amount?: number
  paid_at?: string
  stages?: Record<string, string | null>
}

const parseNotes = (raw: unknown): Notes => {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Notes
  try { return JSON.parse(String(raw)) as Notes } catch { return {} }
}

const METHODS = ['Счёт', 'Наличные', 'Карта', 'Перевод', 'Другое'] as const
type Method = typeof METHODS[number]

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const orderId = Number(id)
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Плохой id заказа' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const { data: u } = await sb.from('users').select('role,name').eq('id', user.id).maybeSingle()
  const me = u as { role?: string; name?: string } | null
  if (!['admin', 'ceo', 'cfo', 'manager', 'commercial'].includes(me?.role ?? '')) {
    return NextResponse.json({ error: 'Нет доступа к отметке оплаты' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as Body | null
  if (!body || !['unpaid', 'partial', 'paid'].includes(body.status)) {
    return NextResponse.json({ error: 'Нужен status: unpaid | partial | paid' }, { status: 400 })
  }
  const method: Method = METHODS.includes(body.method as Method) ? body.method as Method : 'Счёт'
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(body.paidAt ?? '')
    ? body.paidAt!
    : new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })

  const svc = createServiceClient()
  const { data: orderRow, error: oErr } = await svc.from('b2b_orders')
    .select('id, custom_number, client_name, total_after_discount, total_sale_inc_vat, total_cost_net, total_cost_vat, items, created_by_name, notes')
    .eq('id', orderId).maybeSingle()
  if (oErr || !orderRow) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  const order = orderRow as {
    id: number; custom_number: string | null; client_name: string | null
    total_after_discount: number | null; total_sale_inc_vat: number | null
    total_cost_net: number | null; total_cost_vat: number | null; items: unknown; created_by_name: string | null; notes: unknown
  }

  const total = finalTotalOf(order)
  const prepayment = body.status === 'partial' ? Math.max(0, Number(body.amount ?? 0)) : 0
  const notes = parseNotes(order.notes)
  const stages = { ...(notes.stages ?? {}) }
  const prepayKey = b2bPaymentKey(orderId, 'prepayment')
  const settleKey = b2bPaymentKey(orderId, 'settlement')

  // Что уже пришло по заказу, кроме собственного «остатка» этой кнопки (его перезапишет upsert).
  // Считаем ДО записи notes: не прочитали платежи — ничего не пишем.
  let paidOther = 0
  if (body.status === 'paid') {
    try {
      paidOther = (await loadOrderPaid(svc, new Map([[orderId, total]]), { excludeKeys: [settleKey] })).get(orderId) ?? 0
    } catch (e) {
      return NextResponse.json({ error: `Оплата не записана: платежи заказа не прочитались (${e instanceof Error ? e.message : String(e)})` }, { status: 500 })
    }
  }
  const rest = settlementAmount(total, paidOther)
  const alreadyPaid = body.status === 'paid' && rest <= 0

  // 1) legacy-запись: на ней живут бейджи и старые экраны. Пишем ТОЧЕЧНО, а не
  // целым notes: плоские ключи (payment_status/prepayment_amount/paid_at) —
  // shallow-patch; вложенный stages.invoice_paid — mark_order_stages (shallow
  // заменил бы весь stages и вернул клоббер этапов из #274). Ключи, которые надо
  // снять, передаём null — читатели проверяют truthiness.
  const nextNotes: Notes = {
    ...notes,
    payment_status: body.status,
    prepayment_amount: body.status === 'partial' ? prepayment : undefined,
    paid_at: body.status === 'paid' ? new Date().toISOString() : undefined,
    stages: { ...stages, invoice_paid: body.status === 'paid' ? paidAt : null },
  }
  const { error: notesErr } = await svc.rpc('patch_order_notes_shallow', { p_order_id: orderId, p_patch: {
    payment_status: body.status,
    prepayment_amount: body.status === 'partial' ? prepayment : null,
    paid_at: body.status === 'paid' ? nextNotes.paid_at : null,
  } })
  if (notesErr) return NextResponse.json({ error: `Оплата не записана: ${notesErr.message}` }, { status: 500 })
  const { error: stageErr } = await svc.rpc('mark_order_stages', { p_order_id: orderId, p_stages: { invoice_paid: body.status === 'paid' ? paidAt : null } })
  if (stageErr) return NextResponse.json({ error: `Оплата записана, этап «оплачен» — нет: ${stageErr.message}` }, { status: 500 })
  const { error: upErr } = await svc.from('b2b_orders')
    .update({ updated_by_name: me?.name ?? null, updated_at: new Date().toISOString() })
    .eq('id', orderId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // 2–3) ядро платежей + ведомость продаж
  const actor = { enteredBy: user.id, enteredByName: me?.name ?? null }
  const warnings: string[] = []
  const fmtRub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
  if (alreadyPaid) {
    warnings.push(`Платёж не записан: по заказу уже пришло ${fmtRub(paidOther)} из ${fmtRub(total)} — заказ оплачен`)
  }

  try {
    if (body.status === 'paid') {
      if (rest > 0) {
        await recordPayment(svc, {
          externalKey: settleKey, amount: rest, paidAt, kind: paidOther > 0 ? 'remainder' : 'full',
          source: 'b2b_order', method, b2bOrderId: orderId, ...actor,
        })
      } else {
        // Остаток этой кнопки = итог − пришедшее. Пришедшее уже покрыло итог — прежняя
        // отметка «остаток» лишняя и задваивала бы деньги заказа.
        await voidPayment(svc, settleKey, user.id)
      }
      const saleId = await upsertSaleFromB2B(svc, order, { paidAt, manager: order.created_by_name, actorName: me?.name })
      if (saleId) await svc.from('crm_sales').update({ remainder_paid: true, paid_remainder_at: paidAt }).eq('id', saleId)
    } else if (body.status === 'partial' && prepayment > 0) {
      await recordPayment(svc, {
        externalKey: prepayKey, amount: prepayment, paidAt, kind: 'prepayment',
        source: 'b2b_order', method, b2bOrderId: orderId, ...actor,
      })
      await voidPayment(svc, settleKey, user.id)
      const saleId = await upsertSaleFromB2B(svc, order, { paidAt, manager: order.created_by_name, actorName: me?.name })
      if (saleId) await svc.from('crm_sales').update({ prepayment: prepayment, prepayment_paid: true, remainder_paid: false }).eq('id', saleId)
    } else {
      // Оплату сняли: платежи в void, продажа помечена voided. Ничего не удаляем.
      // voided_by — uuid пользователя; имя сюда не влезает, и снятие падало в warnings.
      await voidPayment(svc, prepayKey, user.id)
      await voidPayment(svc, settleKey, user.id)
      await voidSale(svc, { b2bOrderId: orderId })
    }
  } catch (e) {
    // Ядро не должно ломать рабочий процесс менеджера: notes уже записаны.
    warnings.push(e instanceof Error ? e.message : 'Ошибка записи в денежное ядро')
  }

  // А14: менеджеру в Telegram — по его заказу прошла оплата. Себе не пишем.
  if ((body.status === 'paid' && !alreadyPaid) || body.status === 'partial') {
    const num = order.custom_number?.trim() || `#${orderId}`
    const sum = body.status === 'paid' ? total : prepayment
    await notifyOrderManager(
      orderId,
      `💰 ${body.status === 'paid' ? 'Оплачен' : 'Предоплата по'} заказ${body.status === 'paid' ? '' : 'у'} <b>${num}</b> · ${Math.round(sum).toLocaleString('ru-RU')} ₽`
        + `\n${order.client_name ?? ''}`,
      '/b2b-orders',
    )
  }

  return NextResponse.json({ ok: true, notes: nextNotes, warnings, alreadyPaid, recorded: body.status === 'paid' ? rest : prepayment })
}
