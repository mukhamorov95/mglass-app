import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryRead, requireInventoryWrite } from '@/lib/inventory/auth'
import { listMoves, addMoves, type NewMove } from '@/lib/inventory/db'
import type { MoveReason } from '@/lib/inventory/types'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const actor = await requireInventoryRead()
  if (actor instanceof NextResponse) return actor
  const p = req.nextUrl.searchParams
  try {
    const moves = await listMoves({
      itemId: p.get('item') ? Number(p.get('item')) : undefined,
      reason: (p.get('reason') as MoveReason) ?? undefined,
      limit:  p.get('limit') ? Number(p.get('limit')) : 200,
    })
    return NextResponse.json({
      moves: actor.canSeeCost ? moves : moves.map(m => ({ ...m, unit_cost: 0 })),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  try {
    const body = await req.json() as { moves: NewMove[] }
    const res  = await addMoves(body.moves ?? [], actor)
    return NextResponse.json(res)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
