import { NextResponse } from 'next/server'
import { requireInventoryRead } from '@/lib/inventory/auth'
import { summary } from '@/lib/inventory/db'

export const runtime = 'nodejs'

export async function GET() {
  const actor = await requireInventoryRead()
  if (actor instanceof NextResponse) return actor
  try {
    const s = await summary()
    return NextResponse.json(actor.canSeeCost
      ? s
      : { ...s, totalValue: 0, b2b: { ...s.b2b, value: 0 }, b2c: { ...s.b2c, value: 0 } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
