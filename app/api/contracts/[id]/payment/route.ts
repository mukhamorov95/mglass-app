import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { recordPayment, voidPayment } from '@/lib/payments/recordPayment'
import { contractPaymentKey, type PaymentKind, type PaymentMethod } from '@/lib/payments/paymentKeys'
import { upsertSaleFromContract } from '@/lib/salesLedger'

// Поступления по счёту/договору (розница M-Glass). Каждое поступление —
// отдельная строка payments: предоплата, промежуточные, остаток. Первая оплата
// рождает продажу в crm_sales (её и видит Отдел продаж). Ошибочный платёж
// снимается (void), а не удаляется — история цела.

const KINDS: PaymentKind[] = ['prepayment', 'remainder', 'full', 'refund', 'adjustment']
const METHODS: PaymentMethod[] = ['Счёт', 'Наличные', 'Карта', 'Перевод', 'Другое']
const ROLES = ['admin', 'ceo', 'cfo', 'manager', 'commercial'] as const

async function actor(): Promise<{ id: string; name: string } | null> {
  const user = await getSessionUser()
  if (!user) return null
  const sb = await createClient()
  const { data } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
  return { id: user.id, name: (data as { name: string | null } | null)?.name ?? user.email ?? '' }
}

// Договор + его поступления. Сумма/остаток считаются здесь, чтобы экран не
// дублировал арифметику.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...ROLES])
  if (guard instanceof NextResponse) return guard
  const contractId = Number((await ctx.params).id)
  if (!contractId) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const sb = createServiceClient()
  const { data: c } = await sb.from('contracts')
    .select('id, number, total, customer, manager_name, content').eq('id', contractId).maybeSingle()
  if (!c) return NextResponse.json({ error: 'Договор не найден' }, { status: 404 })

  const { data: sale } = await sb.from('crm_sales')
    .select('id, sale_date, voided').eq('contract_id', contractId).maybeSingle()
  const saleRow = sale as { id: number; sale_date: string; voided: boolean } | null

  const { data: pays } = await sb.from('payments')
    .select('id, external_key, amount, paid_at, kind, method, note, entered_by_name, voided_at')
    .eq('crm_sale_id', saleRow?.id ?? -1)
    .order('paid_at', { ascending: true }).order('id', { ascending: true })

  const rows = (pays ?? []) as { amount: number; voided_at: string | null }[]
  const paid = rows.filter(p => !p.voided_at).reduce((s, p) => s + Number(p.amount || 0), 0)
  const total = Number((c as { total: number | null }).total ?? 0)

  return NextResponse.json({
    contract: c,
    sale: saleRow,
    payments: pays ?? [],
    paid: Math.round(paid * 100) / 100,
    remainder: Math.round((total - paid) * 100) / 100,
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...ROLES])
  if (guard instanceof NextResponse) return guard
  const me = await actor()
  if (!me) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const contractId = Number((await ctx.params).id)
  if (!contractId) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }

  const amount = Number(b.amount)
  if (!(amount > 0)) return NextResponse.json({ error: 'Укажите сумму поступления' }, { status: 400 })
  const paidAt = String(b.paid_at ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) return NextResponse.json({ error: 'Укажите дату поступления' }, { status: 400 })
  const kind = KINDS.includes(b.kind as PaymentKind) ? b.kind as PaymentKind : 'prepayment'
  const method = METHODS.includes(b.method as PaymentMethod) ? b.method as PaymentMethod : 'Счёт'

  const sb = createServiceClient()
  const { data: c } = await sb.from('contracts')
    .select('id, number, total, customer, manager_name').eq('id', contractId).maybeSingle()
  if (!c) return NextResponse.json({ error: 'Договор не найден' }, { status: 404 })

  try {
    // Продажа появляется/обновляется от факта оплаты; месяц продажи задаёт
    // ПЕРВОЕ поступление (upsertSaleFromContract не переписывает sale_date).
    const saleId = await upsertSaleFromContract(sb, c as Parameters<typeof upsertSaleFromContract>[1], {
      paidAt, actorName: me.name,
    })
    const payment = await recordPayment(sb, {
      externalKey: contractPaymentKey(contractId, randomUUID()),
      amount, paidAt, kind, method,
      source: 'contract_payment',
      crmSaleId: saleId,
      enteredBy: me.id,
      enteredByName: me.name,
      note: (b.note as string)?.trim() || null,
    })
    return NextResponse.json({ ok: true, saleId, paymentId: payment?.id })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка записи платежа' }, { status: 500 })
  }
}

// Снять ошибочное поступление: строка остаётся с voided_at.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...ROLES])
  if (guard instanceof NextResponse) return guard
  const me = await actor()
  if (!me) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const contractId = Number((await ctx.params).id)

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const key = String(b.external_key ?? '')
  if (!key.startsWith(`contract:${contractId}:`)) {
    return NextResponse.json({ error: 'Платёж не принадлежит этому договору' }, { status: 400 })
  }

  try {
    await voidPayment(createServiceClient(), key, me.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка снятия платежа' }, { status: 500 })
  }
}
