import { NextResponse, type NextRequest } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { getPricing, savePricing } from '@/lib/configurator/pricingStore'
import type { Tier, UnitPrices } from '@/lib/configurator/pricing'

const isTier = (t: string | null): t is Tier => t === 'budget' || t === 'premium'

export async function GET(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const tier = req.nextUrl.searchParams.get('tier')
  if (!isTier(tier)) return NextResponse.json({ error: 'tier: budget|premium' }, { status: 400 })
  return NextResponse.json({ tier, data: await getPricing(tier) })
}

export async function PUT(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => null) as { tier?: string; data?: UnitPrices } | null
  if (!body || !isTier(body.tier ?? null) || !body.data) {
    return NextResponse.json({ error: 'tier + data обязательны' }, { status: 400 })
  }
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  await savePricing(body.tier as Tier, body.data, user?.email ?? 'owner')
  return NextResponse.json({ ok: true })
}
