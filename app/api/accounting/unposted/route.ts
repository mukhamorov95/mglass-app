import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Б5: мост «оплата → ДДС». Оплаты живут в ядре payments, куда бухгалтеру закрыт
// доступ по RLS (и правильно: там же маржа продаж). Поэтому отдаём срез через
// service-role: дата, сумма, способ, клиент, номер заказа — и ничего про
// себестоимость. Проведение рождает cashflow_entries со ссылкой payment_id;
// уникальный индекс не даст провести один платёж дважды.

const FIN_ROLES = ['accountant', 'cfo', 'admin', 'ceo'] as const

type Doc = { kind: 'b2b' | 'b2c' | 'sale'; number: string | null; client: string | null }

const KIND_LABEL: Record<string, string> = {
  prepayment: 'предоплата', remainder: 'остаток', full: 'полная',
  refund: 'возврат', adjustment: 'корректировка',
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const url = new URL(req.url)
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'Нужен период from/to' }, { status: 400 })
  }

  const svc = createServiceClient()
  const [{ data: pays }, { data: posted }, { data: skips }] = await Promise.all([
    svc.from('payments')
      .select('id,amount,paid_at,kind,method,note,b2b_order_id,order_id,crm_sale_id')
      .is('voided_at', null).gte('paid_at', from).lte('paid_at', to)
      .order('paid_at', { ascending: false }),
    svc.from('cashflow_entries').select('payment_id').not('payment_id', 'is', null),
    svc.from('cashflow_payment_skips').select('payment_id,reason'),
  ])

  const done = new Set((posted ?? []).map(r => Number(r.payment_id)))
  const skipped = new Map((skips ?? []).map(r => [Number(r.payment_id), r.reason as string | null]))
  const rows = (pays ?? []).filter(p => !done.has(Number(p.id)))

  // Документы платежей — тремя пачками, чтобы не дёргать базу построчно
  const b2bIds = rows.map(r => r.b2b_order_id).filter(Boolean) as number[]
  const b2cIds = rows.map(r => r.order_id).filter(Boolean) as string[]
  const saleIds = rows.map(r => r.crm_sale_id).filter(Boolean) as number[]
  const [b2b, b2c, sales] = await Promise.all([
    b2bIds.length ? svc.from('b2b_orders').select('id,client_name,custom_number').in('id', b2bIds) : { data: [] },
    b2cIds.length ? svc.from('orders').select('id,client_name,number,custom_number').in('id', b2cIds) : { data: [] },
    saleIds.length ? svc.from('crm_sales').select('id,client,order_no').in('id', saleIds) : { data: [] },
  ])
  const b2bMap = new Map((b2b.data ?? []).map(o => [String(o.id), o]))
  const b2cMap = new Map((b2c.data ?? []).map(o => [String(o.id), o]))
  const saleMap = new Map((sales.data ?? []).map(o => [String(o.id), o]))

  const items = rows.map(p => {
    let doc: Doc = { kind: 'b2c', number: null, client: null }
    if (p.b2b_order_id) {
      const o = b2bMap.get(String(p.b2b_order_id))
      doc = { kind: 'b2b', number: o?.custom_number ?? `#${p.b2b_order_id}`, client: o?.client_name ?? null }
    } else if (p.order_id) {
      const o = b2cMap.get(String(p.order_id))
      doc = { kind: 'b2c', number: o?.custom_number ?? o?.number ?? null, client: o?.client_name ?? null }
    } else if (p.crm_sale_id) {
      const o = saleMap.get(String(p.crm_sale_id))
      doc = { kind: 'sale', number: o?.order_no ?? null, client: o?.client ?? null }
    }
    return {
      id: Number(p.id),
      paid_at: p.paid_at as string,
      amount: Number(p.amount),
      kind_label: KIND_LABEL[p.kind as string] ?? (p.kind as string),
      method: p.method as string,
      note: (p.note as string) ?? null,
      doc,
      skipped: skipped.has(Number(p.id)),
      skip_reason: skipped.get(Number(p.id)) ?? null,
    }
  })

  // Подсказка фонда: как проводили похожий платёж в прошлый раз (по контрагенту,
  // иначе — по способу оплаты). Тот же принцип, что автоподстановка при ручном вводе.
  const { data: prev } = await svc.from('cashflow_entries')
    .select('unit,fund_id,subfund_id,account,counterparty')
    .not('payment_id', 'is', null).eq('kind', 'in')
    .order('id', { ascending: false }).limit(200)
  type PrevEntry = { unit: string; fund_id: number; subfund_id: number | null; account: string | null; counterparty: string | null }
  const byCp = new Map<string, PrevEntry>()
  for (const e of (prev ?? []) as PrevEntry[]) {
    const k = (e.counterparty ?? '').trim().toLowerCase()
    if (k && !byCp.has(k)) byCp.set(k, e)
  }
  const fallback = ((prev ?? []) as PrevEntry[])[0] ?? null

  return NextResponse.json({
    items: items.map(i => ({
      ...i,
      suggest: byCp.get((i.doc.client ?? '').trim().toLowerCase()) ?? fallback,
    })),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { data: me } = await sb.from('users').select('name').eq('id', user?.id ?? '').maybeSingle()
  const myName = (me as { name?: string } | null)?.name ?? user?.email ?? 'бухгалтерия'

  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? 'post')
  const paymentId = Number(body.payment_id)
  if (!(paymentId > 0)) return NextResponse.json({ error: 'Нет платежа' }, { status: 400 })

  const svc = createServiceClient()

  if (action === 'skip') {
    const { error } = await svc.from('cashflow_payment_skips').upsert({
      payment_id: paymentId, reason: String(body.reason ?? '').trim() || null,
      skipped_by: myName, skipped_at: new Date().toISOString(),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'unskip') {
    await svc.from('cashflow_payment_skips').delete().eq('payment_id', paymentId)
    return NextResponse.json({ ok: true })
  }

  const unit = body.unit === 'ooo' ? 'ooo' : 'ip'
  const fundId = Number(body.fund_id)
  if (!(fundId > 0)) return NextResponse.json({ error: 'Выберите фонд' }, { status: 400 })

  const { data: pay } = await svc.from('payments')
    .select('id,amount,paid_at,voided_at').eq('id', paymentId).maybeSingle()
  if (!pay || pay.voided_at) return NextResponse.json({ error: 'Платёж не найден или снят' }, { status: 404 })

  const { error } = await svc.from('cashflow_entries').insert({
    entry_date: pay.paid_at, unit, kind: 'in', fund_id: fundId,
    subfund_id: Number(body.subfund_id) || null, amount: Number(pay.amount),
    account: String(body.account ?? '').trim() || null,
    counterparty: String(body.counterparty ?? '').trim() || null,
    comment: String(body.comment ?? '').trim() || null,
    entered_by: user?.id ?? null, entered_by_name: myName,
    payment_id: paymentId,
  })
  if (error) {
    const dup = error.code === '23505'
    return NextResponse.json(
      { error: dup ? 'Этот платёж уже проведён' : error.message },
      { status: dup ? 409 : 500 },
    )
  }
  await svc.from('cashflow_payment_skips').delete().eq('payment_id', paymentId)
  return NextResponse.json({ ok: true })
}
