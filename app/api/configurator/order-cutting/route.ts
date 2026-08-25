import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getModel, M_MODELS } from '@/lib/configurator/arrangement'
import { computeKitQuantities, type RoleId } from '@/lib/configurator/kit'
import { resolveTierData } from '@/lib/configurator/priceVersion'
import { buildWithVariant } from '@/lib/configurator/quoteContract'
import { planOrderCutting, roleLabel, type OrderItemInput } from '@/lib/configurator/orderPlan'
import type { MDims, MVariant } from '@/components/configurator/scene/assembly'
import type { Tier } from '@/lib/configurator/pricing'

// Общий раскрой на заказ: несколько изделий → сколько сэкономит объединённый раскрой
// профиля/трубы против поштучного. Себестоимость внутри — только owner/buyer.
export const maxDuration = 30

type ItemIn = { model: string; dims: MDims; variant?: MVariant; finishId?: string; choice?: Record<string, string> }

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => null) as { tier?: string; version?: number; items?: ItemIn[] } | null
  const items = (body?.items ?? []).filter(i => i?.model && i.dims && M_MODELS.some(m => m.code === i.model))
  if (items.length === 0) return NextResponse.json({ error: 'items обязательны' }, { status: 400 })
  const tier: Tier = body?.tier === 'premium' ? 'premium' : 'budget'

  const { data: { library, rates, kits } } = await resolveTierData(tier, body?.version)
  const inputs: OrderItemInput[] = items.map(i => {
    const model = getModel(i.model)
    const q = computeKitQuantities(buildWithVariant(model, i.dims, 8, i.variant), 8, model, rates.capMargin)
    return { q, lib: library, kit: kits[i.model] ?? { slots: [] }, finishId: i.finishId ?? 'chrome', opts: { choice: i.choice as Partial<Record<RoleId, string>> | undefined } }
  })

  const report = planOrderCutting(inputs, rates.kerf ?? 0)
  return NextResponse.json({
    ...report,
    cuts: report.cuts.map(c => ({ ...c, roleLabel: roleLabel(c.role) })),
  })
}
