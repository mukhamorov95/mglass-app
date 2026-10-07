import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { FIN_ROLES } from '@/lib/accounting/roles'
import { createServiceClient } from '@/lib/supabase-service'
import { collectAudit } from '@/lib/accounting/collectAudit'
import { loadUpdWaiting } from '@/lib/accounting/updWaiting'
import { settle, type QueueSnapshot } from '@/lib/accounting/queue'
import { readPaged } from '@/lib/money/paged'
import { attachInvoicePayments, asInvoiceRows } from '@/lib/money/invoicePayments'
import { mskDayKey } from '@/lib/time'

export const dynamic = 'force-dynamic'

// «Ждут действия» — стартовая вкладка бухгалтера: сколько чего ждёт сейчас. Каждый
// источник считается отдельно: упал один — у него ошибка словами, остальные на месте.

export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const raw = req.nextUrl.searchParams.get('today') ?? ''
  const today = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : mskDayKey()
  const svc = createServiceClient()

  const count = async (unit: 'ip' | 'ooo') => {
    const { count: n, error } = await svc.from('bank_statement_rows').select('id', { count: 'exact', head: true }).eq('status', 'new').eq('unit', unit)
    if (error) throw new Error(error.message)
    return n ?? 0
  }

  const [bank, audit, upd, invoices] = await Promise.all([
    settle(async () => { const [ip, ooo] = await Promise.all([count('ip'), count('ooo')]); return { ip, ooo, total: ip + ooo } }),
    settle(() => collectAudit(svc, today)),
    settle(() => loadUpdWaiting(svc, today)),
    settle(async () => {
      const rows = await readPaged(() => svc.from('invoices').select('id, amount, order_ids, status').neq('status', 'cancelled').order('id'))
      const open = (await attachInvoicePayments(svc, asInvoiceRows(rows))).filter(i => i.derivedStatus !== 'paid')
      return { count: open.length, sum: Math.round(open.reduce((s, i) => s + i.remainder, 0)) }
    }),
  ])

  const body: QueueSnapshot = { today, bank, audit, upd, invoices }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
