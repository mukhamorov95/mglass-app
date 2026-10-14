import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { FIN_ROLES } from '@/lib/accounting/roles'
import { syncInvoiceToOrders } from '@/lib/money/invoiceSync'

// Счёт выставили, потом поправили просчёт — сумма счёта под текущие итоги заказов.
// Номер тот же, платежи по счёту остаются на нём. Оплаченный счёт не трогаем.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard
  const id = Number((await params).id)
  if (!(id > 0)) return NextResponse.json({ error: 'Плохой id счёта' }, { status: 400 })
  const res = await syncInvoiceToOrders(createServiceClient(), id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json(res)
}
