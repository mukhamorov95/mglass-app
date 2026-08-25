import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Б13: взаиморасчёты с поставщиками. Закупки живут своим контуром
// (purchase_orders + purchase_order_payments), деньги — в ДДС, заявки — третьим
// списком. Сводим по контрагенту и честно показываем расхождение между
// «оплачено по закупкам» и «оплачено деньгами»: сходятся не всегда, и это
// само по себе диагноз, а не повод усреднять.

const FIN_ROLES = ['accountant', 'cfo', 'admin', 'ceo'] as const

const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().replace(/[«»"'`]/g, '').replace(/\s+/g, ' ')
    .replace(/^(ооо|ип|ао|зао|пао)\s+/, '').trim()

type Row = {
  name: string
  ordered: number       // выставлено закупками
  paidPurchase: number  // отмечено оплаченным в закупках
  paidCash: number      // ушло деньгами по ДДС
  openRequests: number  // ждут комитета или одобрены
  lastOp: string | null
  balance: number       // ordered − paidPurchase
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const url = new URL(req.url)
  const unit = url.searchParams.get('unit') === 'ooo' ? 'ooo' : 'ip'
  const from = url.searchParams.get('from') ?? '2026-01-01'

  const svc = createServiceClient()
  const [{ data: pos }, { data: pops }, { data: entries }, { data: reqs }] = await Promise.all([
    svc.from('purchase_orders').select('id,supplier_name,amount,status,created_at').limit(2000),
    svc.from('purchase_order_payments').select('purchase_order_id,amount,payment_date').limit(4000),
    svc.from('cashflow_entries').select('counterparty,amount,entry_date')
      .eq('unit', unit).eq('kind', 'out').gte('entry_date', from)
      .not('counterparty', 'is', null).limit(4000),
    svc.from('payment_requests').select('counterparty,amount,status')
      .eq('unit', unit).in('status', ['pending', 'approved']).limit(500),
  ])

  const paidByPo = new Map<number, number>()
  for (const p of pops ?? []) {
    const k = Number(p.purchase_order_id)
    paidByPo.set(k, (paidByPo.get(k) ?? 0) + Number(p.amount))
  }

  const rows = new Map<string, Row>()
  const touch = (name: string): Row => {
    const key = norm(name)
    if (!rows.has(key)) {
      rows.set(key, { name: name.trim(), ordered: 0, paidPurchase: 0, paidCash: 0, openRequests: 0, lastOp: null, balance: 0 })
    }
    return rows.get(key)!
  }

  for (const po of pos ?? []) {
    if (!po.supplier_name || po.status === 'cancelled') continue
    const r = touch(po.supplier_name as string)
    r.ordered += Number(po.amount ?? 0)
    r.paidPurchase += paidByPo.get(Number(po.id)) ?? 0
  }
  for (const e of entries ?? []) {
    const r = touch(e.counterparty as string)
    r.paidCash += Number(e.amount)
    const d = e.entry_date as string
    if (!r.lastOp || d > r.lastOp) r.lastOp = d
  }
  for (const q of reqs ?? []) {
    if (!q.counterparty) continue
    touch(q.counterparty as string).openRequests += Number(q.amount)
  }

  const items = [...rows.values()]
    .map(r => ({ ...r, balance: Math.round((r.ordered - r.paidPurchase) * 100) / 100 }))
    .filter(r => r.ordered || r.paidCash || r.openRequests)
    .sort((a, b) => (b.balance - a.balance) || (b.paidCash - a.paidCash))

  return NextResponse.json({
    items,
    totals: items.reduce((t, r) => ({
      ordered: t.ordered + r.ordered, paidPurchase: t.paidPurchase + r.paidPurchase,
      paidCash: t.paidCash + r.paidCash, debt: t.debt + Math.max(0, r.balance),
      openRequests: t.openRequests + r.openRequests,
    }), { ordered: 0, paidPurchase: 0, paidCash: 0, debt: 0, openRequests: 0 }),
  })
}
