import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { recordPayment, voidPayment } from '@/lib/payments/recordPayment'
import { salePaymentKey } from '@/lib/payments/paymentKeys'

// Отдел продаж: леджер продаж. GET — продажи за месяц + итоги + по менеджерам
// (владелец/РОП — все, менеджер — свои). POST — создать продажу (в т.ч. из лида).
// PATCH — правки (оплата предоплаты/остатка, статус закрыт, суммы).

const PAY = ['Счёт', 'Наличные', 'Карта', 'Перевод']
const METHODS = ['Счёт', 'Наличные', 'Карта', 'Перевод', 'Другое'] as const
type Method = typeof METHODS[number]

async function whoAmI(): Promise<{ name: string; canAll: boolean } | null> {
  const user = await getSessionUser()
  if (!user) return null
  const sb = await createClient()
  const { data } = await sb.from('users').select('name,role,can_view_all_deals').eq('id', user.id).maybeSingle()
  const p = data as { name: string | null; role: string | null; can_view_all_deals: boolean | null } | null
  const name = p?.name ?? user.email ?? ''
  const canAll = ['admin', 'ceo', 'commercial'].includes(p?.role ?? '') || !!p?.can_view_all_deals
  return { name, canAll }
}

// Границы месяца по строке YYYY-MM (или текущий), без Date-в-рендере на клиенте.
function monthRange(m: string | null): { from: string; to: string; ym: string } {
  const now = new Date()
  let y = now.getFullYear(), mo = now.getMonth() + 1
  const mm = /^(\d{4})-(\d{2})$/.exec(m ?? '')
  if (mm) { y = Number(mm[1]); mo = Number(mm[2]) }
  const from = `${y}-${String(mo).padStart(2, '0')}-01`
  const ny = mo === 12 ? y + 1 : y, nmo = mo === 12 ? 1 : mo + 1
  const to = `${ny}-${String(nmo).padStart(2, '0')}-01`
  return { from, to, ym: `${y}-${String(mo).padStart(2, '0')}` }
}

type SaleRow = { id: number; amount: number; manager: string | null }

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'manager', 'commercial'])
  if (guard instanceof NextResponse) return guard
  const me = await whoAmI()
  if (!me) return NextResponse.json({ error: 'no user' }, { status: 401 })

  const { from, to, ym } = monthRange(new URL(req.url).searchParams.get('month'))
  const sb = createServiceClient()
  // Отдел продаж — ТОЛЬКО розница M-Glass. B2B/производство сюда не мешаем:
  // каждый оплаченный B2B-заказ автоматически рождает строку department='b2b'
  // (lib/salesLedger.upsertSaleFromB2B + ночной реконсилиатор), и без фильтра
  // они занижали средний чек. То же правило уже действует в сверке денег
  // (api/cron/money-integrity) и в замороженном базлайне.
  let query = sb.from('crm_sales').select('*')
    .gte('sale_date', from).lt('sale_date', to)
    .eq('voided', false).neq('department', 'b2b')
    .order('sale_date', { ascending: true }).order('id', { ascending: true })
  if (!me.canAll) query = query.eq('manager', me.name)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const sales = (data ?? []) as SaleRow[]

  // «Поступило» ≠ «продано»: продажа считается полной суммой счёта в месяце
  // первой оплаты, а деньги приходят частями (предоплата/промежуточные/остаток)
  // и живут построчно в payments. Показываем обе цифры — их расхождение и есть
  // дебиторка месяца.
  const saleIds = sales.map(r => r.id)
  const paidBySale = new Map<number, number>()
  if (saleIds.length > 0) {
    const { data: pays } = await sb.from('payments')
      .select('crm_sale_id, amount')
      .in('crm_sale_id', saleIds)
      .is('voided_at', null)
    for (const p of (pays ?? []) as { crm_sale_id: number | null; amount: number }[]) {
      if (p.crm_sale_id == null) continue
      paidBySale.set(p.crm_sale_id, (paidBySale.get(p.crm_sale_id) ?? 0) + Number(p.amount || 0))
    }
  }

  const sum = sales.reduce((s, r) => s + Number(r.amount || 0), 0)
  const paid = sales.reduce((s, r) => s + (paidBySale.get(r.id) ?? 0), 0)
  const count = sales.length
  const avg = count ? Math.round(sum / count) : 0
  const byMgr = new Map<string, { manager: string; count: number; sum: number; paid: number }>()
  for (const r of sales) {
    const k = r.manager || '—'
    const cur = byMgr.get(k) ?? { manager: k, count: 0, sum: 0, paid: 0 }
    cur.count++; cur.sum += Number(r.amount || 0); cur.paid += paidBySale.get(r.id) ?? 0
    byMgr.set(k, cur)
  }
  const managers = [...byMgr.values()].map(m => ({ ...m, avg: m.count ? Math.round(m.sum / m.count) : 0 })).sort((a, b) => b.sum - a.sum)

  const salesOut = sales.map(r => ({ ...r, paid_amount: paidBySale.get(r.id) ?? 0 }))
  return NextResponse.json({ sales: salesOut, totals: { sum, count, avg, paid }, managers, month: ym, me: me.name, canAll: me.canAll })
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'manager', 'commercial'])
  if (guard instanceof NextResponse) return guard
  const me = await whoAmI()
  if (!me) return NextResponse.json({ error: 'no user' }, { status: 401 })

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const amount = Number(b.amount)
  if (!amount || amount <= 0) return NextResponse.json({ error: 'Укажите сумму продажи' }, { status: 400 })

  const row = {
    lead_id: Number(b.lead_id) || null,
    sale_date: (b.sale_date as string) || new Date().toISOString().slice(0, 10),
    ready_date: (b.ready_date as string) || null,
    department: (b.department as string) || 'Розница',
    order_no: (b.order_no as string)?.trim() || null,
    client: (b.client as string)?.trim() || null,
    amount,
    partner_fee: Number(b.partner_fee) || 0,
    prepayment: Number(b.prepayment) || 0,
    prepayment_paid: !!b.prepayment_paid,
    remainder_paid: !!b.remainder_paid,
    payment_method: PAY.includes(b.payment_method as string) ? (b.payment_method as string) : 'Счёт',
    manager: (b.manager as string)?.trim() || me.name,
    created_by: me.name,
  }
  const sb = createServiceClient()
  const { data, error } = await sb.from('crm_sales').insert(row).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (row.lead_id) {
    await sb.from('crm_lead_events').insert({
      lead_id: row.lead_id, kind: 'system',
      text: `💰 Продано: ${Math.round(amount).toLocaleString('ru-RU')} ₽${row.order_no ? ` · заказ ${row.order_no}` : ''}`,
      author: me.name,
    })
  }
  return NextResponse.json({ ok: true, id: (data as { id: number }).id })
}

export async function PATCH(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'manager', 'commercial'])
  if (guard instanceof NextResponse) return guard
  const me = await whoAmI()
  if (!me) return NextResponse.json({ error: 'no user' }, { status: 401 })

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const id = Number(b.id)
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ['prepayment_paid', 'remainder_paid'] as const) if (k in b) patch[k] = !!b[k]
  if ('status' in b) patch.status = b.status === 'closed' ? 'closed' : 'open'
  for (const k of ['amount', 'partner_fee', 'prepayment'] as const) if (k in b) patch[k] = Number(b[k]) || 0
  for (const k of ['order_no', 'client', 'ready_date', 'sale_date', 'department', 'payment_method', 'manager', 'note'] as const) if (k in b) patch[k] = (b[k] as string) || null

  const sb = createServiceClient()
  const { data: before } = await sb.from('crm_sales')
    .select('id, amount, prepayment, sale_date, b2b_order_id, order_id, payment_method').eq('id', id).maybeSingle()
  const { error } = await sb.from('crm_sales').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Д2: галочки оплаты в ведомости — тоже событие денег, пишем в ядро.
  // Ключ канонизируется по документу, поэтому отметка здесь и в заказе
  // дают одну и ту же строку payments, а не дубль.
  const warnings: string[] = []
  const sale = before as {
    id: number; amount: number | null; prepayment: number | null; sale_date: string
    b2b_order_id: number | null; order_id: string | null; payment_method: string | null
  } | null
  if (sale && ('prepayment_paid' in b || 'remainder_paid' in b)) {
    const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.sale_date ?? sale.sale_date))
      ? String(patch.sale_date ?? sale.sale_date) : new Date().toISOString().slice(0, 10)
    const method = METHODS.includes(sale.payment_method as Method) ? sale.payment_method as Method : 'Счёт'
    const total = Number(patch.amount ?? sale.amount ?? 0)
    const prepay = Number(patch.prepayment ?? sale.prepayment ?? 0)
    const link = { id: sale.id, b2b_order_id: sale.b2b_order_id, order_id: sale.order_id }
    try {
      if ('prepayment_paid' in b) {
        const key = salePaymentKey(link, 'prepayment')
        if (b.prepayment_paid && prepay > 0) {
          await recordPayment(sb, {
            externalKey: key, amount: prepay, paidAt, kind: 'prepayment', source: 'sales_ledger',
            method, b2bOrderId: sale.b2b_order_id, orderId: sale.order_id, crmSaleId: sale.id, enteredByName: me.name,
          })
        } else await voidPayment(sb, key, me.name)
      }
      if ('remainder_paid' in b) {
        const key = salePaymentKey(link, 'remainder')
        const rest = Math.round((total - prepay) * 100) / 100
        if (b.remainder_paid && rest > 0) {
          await recordPayment(sb, {
            externalKey: key, amount: rest, paidAt, kind: prepay > 0 ? 'remainder' : 'full', source: 'sales_ledger',
            method, b2bOrderId: sale.b2b_order_id, orderId: sale.order_id, crmSaleId: sale.id, enteredByName: me.name,
          })
        } else await voidPayment(sb, key, me.name)
      }
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : 'Ошибка записи в денежное ядро')
    }
  }
  return NextResponse.json({ ok: true, warnings })
}
