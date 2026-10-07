import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { FIN_ROLES } from '@/lib/accounting/roles'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { readPaged } from '@/lib/money/paged'
import { attachInvoicePayments, asInvoiceRows } from '@/lib/money/invoicePayments'
import { syncInvoiceStatus } from '@/lib/money/invoiceManualPayment'

// Б8: реестр документов в кабинете бухгалтера. Счета B2B (таблица invoices),
// договоры/акты розницы (contracts) и отметка выдачи УПД — в одном списке,
// потому что вопрос бухгалтера один: «что выставлено и что закрыто».
// Договоры читаем service-role: их RLS заточена под менеджеров, а бухгалтеру
// нужен только заголовок документа — без спецификации и себестоимости.


type Customer = { name?: string; full_name?: string; fio?: string; company?: string }

const customerName = (c: unknown): string | null => {
  const o = (c ?? {}) as Customer
  return o.full_name || o.name || o.fio || o.company || null
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const from = new URL(req.url).searchParams.get('from') ?? ''
  const svc = createServiceClient()

  const day = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null
  const con = svc.from('contracts')
    .select('id,number,date,customer,total,status,manager_name,created_at')
    .order('id', { ascending: false }).limit(300)

  // Статус счёта — по платежам (lib/money/invoiceStatus), колонка status — только «отменён».
  let invoices: Awaited<ReturnType<typeof attachInvoicePayments<ReturnType<typeof asInvoiceRows>[number]>>>
  try {
    const rows = await readPaged(() => {
      const q = svc.from('invoices')
        .select('id,invoice_no,payer_name,amount,vat,status,issued_at,paid_at,upd_issued_at,order_ids,created_by_name')
        .order('id', { ascending: false })
      return day ? q.gte('issued_at', day) : q
    })
    invoices = await attachInvoicePayments(svc, asInvoiceRows(rows))
  } catch (e) {
    return NextResponse.json({ error: `Счета не загрузились: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
  const contracts = await (day ? con.gte('created_at', day) : con)
  if (contracts.error) return NextResponse.json({ error: `Договоры не загрузились: ${contracts.error.message}` }, { status: 500 })

  return NextResponse.json({
    invoices: invoices.map(i => ({
      id: i.id, no: String(i.invoice_no ?? i.id), payer: (i.payer_name as string) ?? null,
      amount: i.amount ?? 0, vat: Number(i.vat ?? 0), status: i.status,
      issued_at: i.issued_at as string, paid_at: i.lastPaidAt ?? (i.paid_at as string) ?? null,
      paid: i.paid, remainder: i.remainder, derived: i.derivedStatus,
      upd_issued_at: (i.upd_issued_at as string) ?? null,
      orders: i.order_ids ?? [], author: (i.created_by_name as string) ?? null,
    })),
    contracts: (contracts.data ?? []).map(c => ({
      id: Number(c.id), no: c.number as string,
      date: (c.date as string) ?? String(c.created_at).slice(0, 10),
      client: customerName(c.customer), amount: Number(c.total ?? 0),
      status: c.status as string, manager: (c.manager_name as string) ?? null,
    })),
  })
}

export async function PATCH(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const body = await req.json().catch(() => ({}))
  const id = Number(body.id)
  if (!(id > 0)) return NextResponse.json({ error: 'Нет счёта' }, { status: 400 })

  // «Оплачен» — платёж на остаток через POST /api/invoices/[id]/payment, не флажок.
  if (body.status === 'paid') {
    return NextResponse.json({ error: 'Оплату записывает кнопка «Оплачен» — платежом на остаток' }, { status: 400 })
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.status === 'issued') { patch.status = 'issued'; patch.paid_at = null }
  if (body.status === 'cancelled') patch.status = 'cancelled'
  if ('upd' in body) patch.upd_issued_at = body.upd ? (body.upd_date ?? new Date().toISOString().slice(0, 10)) : null
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: 'Нечего менять' }, { status: 400 })

  const svc = createServiceClient()
  const { data, error } = await svc.from('invoices').update(patch).eq('id', id).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Счёт не найден' }, { status: 404 })
  if (body.status === 'issued') {
    const synced = await syncInvoiceStatus(svc, id)
    if (!synced.ok) return NextResponse.json({ error: synced.error }, { status: synced.status })
  }
  return NextResponse.json({ ok: true, by: user?.id ?? null })
}
