import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryWrite } from '@/lib/inventory/auth'
import { applyCount } from '@/lib/inventory/db'

export const runtime = 'nodejs'

// Инвентаризация: приходит ФАКТ по позициям, разницу система пишет сама.
export async function POST(req: NextRequest) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  try {
    const body = await req.json() as { rows: { item_id: number; actual: number }[] }
    return NextResponse.json(await applyCount(body.rows ?? [], actor))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
