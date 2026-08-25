import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { findSavings } from '@/lib/supplier/savings'
import type { Tier } from '@/lib/configurator/pricing'

// Где мы переплачиваем: позиции комплектов, у которых есть более дешёвый аналог.
// Себестоимость — только для владельца и закупщика, наружу этот маршрут не ходит.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const t = req.nextUrl.searchParams.get('tier')
  const tier: Tier = t === 'premium' ? 'premium' : 'budget'
  const minPct = Number(req.nextUrl.searchParams.get('min') ?? 5)
  return NextResponse.json(await findSavings(tier, Number.isFinite(minPct) ? minPct : 5))
}
