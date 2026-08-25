import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createPaymentLink, paymentsEnabled } from '@/lib/payments/provider'
import { parseNotes } from '@/lib/b2b/publicQuote'

// А8: менеджер получает ссылку на оплату по заказу и отправляет её клиенту.
// Провайдер общий с кабинетом партнёра (lib/payments/provider): пока эквайринг
// не подключён (нет PAYMENT_PROVIDER) — честный 501, а не мнимая ссылка.

const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'cfo'] as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard

  if (!paymentsEnabled()) {
    return NextResponse.json({
      error: 'Онлайн-оплата не подключена. Нужен эквайринг: владелец выбирает провайдера и даёт ключи (PAYMENT_PROVIDER).',
    }, { status: 501 })
  }

  const { id } = await params
  const orderId = Number(id)
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const sb = await createServerClient()
  const { data: order } = await sb.from('b2b_orders')
    .select('id, custom_number, total_after_discount, total_sale_inc_vat, notes')
    .eq('id', orderId).maybeSingle()
  if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const notes = parseNotes(order.notes as string | null)
  if (notes.payment_status === 'paid') return NextResponse.json({ error: 'Заказ уже оплачен' }, { status: 409 })

  const total = Number(order.total_after_discount) || Number(order.total_sale_inc_vat) || 0
  // Частичная оплата: ссылку выставляем на остаток, а не на всю сумму.
  const paid = notes.payment_status === 'partial' ? Number(notes.prepayment_amount) || 0 : 0
  const amount = Math.round(total - paid)
  if (amount <= 0) return NextResponse.json({ error: 'Нечего оплачивать' }, { status: 400 })

  const number = (order.custom_number as string | null)?.trim() || `#${orderId}`
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/$/, '')
  const link = await createPaymentLink({
    orderId, amount,
    description: `Оплата заказа ${number} · M-Glass`,
    returnUrl: `${base}/b2b-quotes/${orderId}/invoice`,
  })
  if (!link) return NextResponse.json({ error: 'Провайдер оплаты не ответил' }, { status: 502 })

  return NextResponse.json({ ok: true, url: link.url, amount })
}
