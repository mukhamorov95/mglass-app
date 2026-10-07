import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { UPD_ACCOUNTING_ROLES, loadUpdIssued } from '@/lib/b2b/updRegistry'

// Выданный УПД для печати бухгалтером: только закреплённая копия из реестра. Сам заказ
// бухгалтеру не открывается — /b2b-quotes ему закрыт, а документу заказ и не нужен.
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const guard = await requireRole(UPD_ACCOUNTING_ROLES)
  if (guard instanceof NextResponse) return guard
  const { orderId } = await params
  const id = Number(orderId)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  try {
    const issued = await loadUpdIssued(createServiceClient(), id)
    if (!issued) return NextResponse.json({ error: 'УПД по этому заказу не выдан' }, { status: 404 })
    return NextResponse.json({ issued })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
