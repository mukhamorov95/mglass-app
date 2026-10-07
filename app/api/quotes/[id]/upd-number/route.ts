import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { loadOrderWithAccess } from '@/lib/b2bOrderAccess'
import { parseNotes } from '@/lib/b2b/publicQuote'
import { updDocDate } from '@/lib/b2b/updLines'
import { assignUpdNumber } from '@/lib/b2b/updRegistry'

// Выдача сквозного номера УПД при печати/PDF (этап 5 docs/b2b/ORDER_PANEL_ROUTE.md).
// Дату документа считает сервер из заказа — клиенту её не доверяем: номер и дата
// закрепляются навсегда.
const UPD_ISSUERS = new Set(['admin', 'ceo', 'manager', 'accountant', 'cfo'])

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await loadOrderWithAccess(id)
  if (res.status !== 200) return NextResponse.json({ error: res.error }, { status: res.status })
  const { order, user, role } = res
  if (!role || !UPD_ISSUERS.has(role)) {
    return NextResponse.json({ error: 'Выдать УПД может менеджер, бухгалтерия или владелец' }, { status: 403 })
  }
  const svc = createServiceClient()
  const { data: prof } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
  const { date } = updDocDate(parseNotes(order.notes as string | null), order.created_at as string)
  try {
    const out = await assignUpdNumber(svc, order.id as number, date, { id: user.id, name: (prof?.name as string | null) ?? user.email ?? null })
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
