import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { recordPayment, voidPayment } from '@/lib/payments/recordPayment'
import { b2bPaymentKey } from '@/lib/payments/paymentKeys'
import { upsertSaleFromB2B, voidSale } from '@/lib/salesLedger'

// Д2: ЕДИНСТВЕННЫЙ писатель оплаты B2B-заказа. Все три экрана (просчёты,
// заказы, дебиторка CFO) ходят сюда — прямых update из браузера больше нет.
// Один вызов делает три вещи и не расходится:
//   1) notes (legacy, на нём живут старые экраны и бейджи)
//   2) payments — денежное ядро, ключ по бизнес-документу (идемпотентно)
//   3) crm_sales — ведомость продаж, needs_review=true (менеджер дозаполнит)
// Снятие оплаты не удаляет ничего: payments → voided_at, crm_sales → voided.

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
    .select('id, custom_number, client_name, total_after_discount, total_sale_inc_vat, total_cost_net, created_by_name, notes')
    .eq('id', orderId).maybeSingle()
  if (oErr || !orderRow) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  const order = orderRow as {
    id: number; custom_number: string | null; client_name: string | null
    total_after_discount: number | null; total_sale_inc_vat: number | null
    total_cost_net: number | null; created_by_name: string | null; notes: unknown
  }

  const total = Number(order.total_after_discount ?? order.total_sale_inc_vat ?? 0)
  const prepayment = body.status === 'partial' ? Math.max(0, Number(body.amount ?? 0)) : 0
  const notes = parseNotes(order.notes)
  const stages = { ...(notes.stages ?? {}) }

  // 1) legacy-запись: на ней живут бейджи и старые экраны
  const nextNotes: Notes = {
    ...notes,
    payment_status: body.status,
    prepayment_amount: body.status === 'partial' ? prepayment : undefined,
    paid_at: body.status === 'paid' ? new Date().toISOString() : undefined,
    stages: { ...stages, invoice_paid: body.status === 'paid' ? paidAt : null },
  }
  const { error: upErr } = await svc.from('b2b_orders')
    .update({ notes: JSON.stringify(nextNotes), updated_by_name: me?.name ?? null, updated_at: new Date().toISOString() })
    .eq('id', orderId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // 2–3) ядро платежей + ведомость продаж
  const prepayKey = b2bPaymentKey(orderId, 'prepayment')
  const settleKey = b2bPaymentKey(orderId, 'settlement')
  const actor = { enteredBy: user.id, enteredByName: me?.name ?? null }
  const warnings: string[] = []

  try {
    if (body.status === 'paid') {
      // Полная оплата: остаток = сумма − уже принятая предоплата.
      const paidPrepay = Number(notes.prepayment_amount ?? 0)
      const rest = Math.round((total - paidPrepay) * 100) / 100
      if (rest > 0) {
        await recordPayment(svc, {
          externalKey: settleKey, amount: rest, paidAt, kind: paidPrepay > 0 ? 'remainder' : 'full',
          source: 'b2b_order', method, b2bOrderId: orderId, ...actor,
        })
      }
      const saleId = await upsertSaleFromB2B(svc, order, { paidAt, manager: order.created_by_name, actorName: me?.name })
      if (saleId) await svc.from('crm_sales').update({ remainder_paid: true, paid_remainder_at: paidAt }).eq('id', saleId)
    } else if (body.status === 'partial' && prepayment > 0) {
      await recordPayment(svc, {
        externalKey: prepayKey, amount: prepayment, paidAt, kind: 'prepayment',
        source: 'b2b_order', method, b2bOrderId: orderId, ...actor,
      })
      await voidPayment(svc, settleKey, me?.name ?? undefined)
      const saleId = await upsertSaleFromB2B(svc, order, { paidAt, manager: order.created_by_name, actorName: me?.name })
      if (saleId) await svc.from('crm_sales').update({ prepayment: prepayment, prepayment_paid: true, remainder_paid: false }).eq('id', saleId)
    } else {
      // Оплату сняли: платежи в void, продажа помечена voided. Ничего не удаляем.
      await voidPayment(svc, prepayKey, me?.name ?? undefined)
      await voidPayment(svc, settleKey, me?.name ?? undefined)
      await voidSale(svc, { b2bOrderId: orderId })
    }
  } catch (e) {
    // Ядро не должно ломать рабочий процесс менеджера: notes уже записаны.
    warnings.push(e instanceof Error ? e.message : 'Ошибка записи в денежное ядро')
  }

  return NextResponse.json({ ok: true, notes: nextNotes, warnings })
}
