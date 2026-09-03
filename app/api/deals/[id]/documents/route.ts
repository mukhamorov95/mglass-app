import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor, canSeeDeal } from '@/lib/b2c/dealScope'

export const dynamic = 'force-dynamic'

// Документы и деньги сделки: КП, договоры, счета, привязанные к сделке (deal_id).
// Связь ставится в момент создания из карточки — старые документы сюда не попадают.
// Скоуп — как в /api/deals/[id]: requireDealActor + canSeeDeal, сервис-клиент.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const svc = createServiceClient()
  const { data: deal } = await svc.from('deals').select('created_by, manager_id').eq('id', dealId).maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 })
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  const [{ data: kps }, { data: contracts }, { data: invoices }, { data: measures }] = await Promise.all([
    svc.from('commercial_proposals')
      .select('id, number, total, status, manager_name, created_at')
      .eq('deal_id', dealId).order('created_at', { ascending: false }),
    svc.from('contracts')
      .select('id, number, kp_id, total, make_sum, install_sum, status, manager_name, created_at')
      .eq('deal_id', dealId).order('created_at', { ascending: false }),
    svc.from('invoices')
      .select('id, invoice_no, amount, status, issued_at, paid_at')
      .eq('deal_id', dealId).order('issued_at', { ascending: false }),
    svc.from('measure_requests')
      .select('id, status, scope, measurer_name, scheduled_at, photos, created_at')
      .eq('deal_id', dealId).order('created_at', { ascending: false }),
  ])

  return NextResponse.json({
    kps: kps ?? [],
    contracts: contracts ?? [],
    invoices: invoices ?? [],
    measures: measures ?? [],
  }, { headers: { 'Cache-Control': 'no-store' } })
}
