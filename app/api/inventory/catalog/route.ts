import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryRead, requireInventoryWrite } from '@/lib/inventory/auth'
import { catalogCandidates, importFromCatalog } from '@/lib/inventory/db'
import type { RefTable } from '@/lib/inventory/types'

export const runtime = 'nodejs'

// Что можно завести на склад из уже существующих справочников — без повторного ввода.
export async function GET() {
  const actor = await requireInventoryRead()
  if (actor instanceof NextResponse) return actor
  try {
    return NextResponse.json({ candidates: await catalogCandidates() })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  try {
    const body = await req.json() as { refs: { ref_table: RefTable; ref_id: string }[] }
    return NextResponse.json({ created: await importFromCatalog(body.refs ?? []) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
