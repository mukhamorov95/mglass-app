import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryRead, requireInventoryWrite } from '@/lib/inventory/auth'
import { reserveForOrder, releaseReservation, listReservations } from '@/lib/inventory/reserve'
import type { DocType } from '@/lib/inventory/types'
import type { B2BItemLike, BomLike } from '@/lib/inventory/plan'

export const runtime = 'nodejs'

// Резерв под заказ по HTTP — альтернатива прямому импорту reserveForOrder из
// launch-production. Best-effort: вызывающий не должен падать из-за склада.
export async function POST(req: NextRequest) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  try {
    const body = await req.json() as { type: DocType; id: string; items: B2BItemLike[] | BomLike[] }
    if (!body.type || !body.id) return NextResponse.json({ error: 'Нужны type и id заказа' }, { status: 400 })
    const result = await reserveForOrder(body.type, body.id, body.items ?? [], { userId: actor.userId, name: actor.name })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  const actor = await requireInventoryRead()
  if (actor instanceof NextResponse) return actor
  const p = req.nextUrl.searchParams
  const type = p.get('type') as DocType | null
  const id   = p.get('id')
  if (!type || !id) return NextResponse.json({ error: 'Нужны type и id заказа' }, { status: 400 })
  return NextResponse.json({ reservations: await listReservations(type, id) })
}

export async function DELETE(req: NextRequest) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  const p = req.nextUrl.searchParams
  const type = p.get('type') as DocType | null
  const id   = p.get('id')
  if (!type || !id) return NextResponse.json({ error: 'Нужны type и id заказа' }, { status: 400 })
  return NextResponse.json({ released: await releaseReservation(type, id) })
}
