import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryRead, requireInventoryWrite } from '@/lib/inventory/auth'
import { listItems, createItem, updateItem, type ItemInput } from '@/lib/inventory/db'
import type { Contour, Kind } from '@/lib/inventory/types'

export const runtime = 'nodejs'

// Себестоимость видят не все — вырезаем на выходе, а не в UI.
function mask<T extends { avg_cost: number }>(rows: T[], canSeeCost: boolean): T[] {
  return canSeeCost ? rows : rows.map(r => ({ ...r, avg_cost: 0 }))
}

export async function GET(req: NextRequest) {
  const actor = await requireInventoryRead()
  if (actor instanceof NextResponse) return actor

  const p = req.nextUrl.searchParams
  try {
    const rows = await listItems({
      contour: (p.get('contour') as Contour | 'all') ?? 'all',
      kind:    (p.get('kind')    as Kind    | 'all') ?? 'all',
      search:  p.get('search') ?? undefined,
      onlyDeficit:     p.get('deficit') === '1',
      includeInactive: p.get('inactive') === '1',
    })
    return NextResponse.json({ items: mask(rows, actor.canSeeCost), canSeeCost: actor.canSeeCost, role: actor.role })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  try {
    const item = await createItem(await req.json() as ItemInput)
    return NextResponse.json({ item })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

// Массовая правка настроек позиций (минимум, норма, место) прямо из таблицы.
export async function PATCH(req: NextRequest) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  try {
    const body = await req.json() as { items: ({ id: number } & ItemInput)[] }
    const rows = body.items ?? []
    for (const { id, ...patch } of rows) await updateItem(id, patch)
    return NextResponse.json({ updated: rows.length })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
