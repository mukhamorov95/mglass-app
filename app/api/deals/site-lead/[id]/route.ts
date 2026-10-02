import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor, canSeeDeal } from '@/lib/b2c/dealScope'
import { parseLeadConfig, leadConfigLine } from '@/lib/configurator/leadPayload'
import { leadToBuild } from '@/lib/calc/leadToBuild'

export const dynamic = 'force-dynamic'

// Заявка 3D-конструктора для «Расчёта» (/calculator/build?lead=, Ш3). Телефон — личные
// данные: заявку со сделкой видит тот, кто видит сделку; без сделки — только видящие всё.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const leadId = Number((await params).id)
  if (!Number.isFinite(leadId) || leadId <= 0) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const svc = createServiceClient()
  const { data: lead } = await svc.from('site_leads')
    .select('id, created_at, name, phone, config, deal_id').eq('id', leadId).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })

  let deal: { id: number; title: string } | null = null
  if (lead.deal_id != null) {
    const { data: d } = await svc.from('deals')
      .select('id, client_name, address, created_by, manager_id').eq('id', lead.deal_id).maybeSingle()
    if (d && !canSeeDeal(actor, d)) return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
    if (d) deal = { id: Number(d.id), title: [d.client_name, d.address].filter(Boolean).join(' · ') || `сделка #${d.id}` }
  } else if (!actor.seeAll) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  const config = parseLeadConfig(lead.config)
  return NextResponse.json({
    lead: { id: Number(lead.id), created_at: lead.created_at, name: lead.name ?? '', phone: lead.phone, line: config ? leadConfigLine(config) : null },
    deal,
    open: config ? leadToBuild(config) : null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
