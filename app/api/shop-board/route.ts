import { NextRequest, NextResponse } from 'next/server'
import { boardGate } from '@/lib/shopBoard/auth'
import { createCard, loadBoard } from '@/lib/shopBoard/server'
import { parseCardInput } from '@/lib/shopBoard/model'

// Табло цеха (docs/SHOP_BOARD_ROUTE.md). GET — табло (lite=1 — только открытые, для ленты);
// POST — новое поручение. Роль сотрудника — в boardGate, право ставить — в createCard.
export async function GET(req: NextRequest) {
  const gate = await boardGate()
  if (gate instanceof NextResponse) return gate
  const lite = req.nextUrl.searchParams.get('lite') === '1'
  try {
    return NextResponse.json(await loadBoard(gate.svc, gate.actor, { lite }))
  } catch (e) {
    return NextResponse.json({ error: `Табло не загрузилось: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await boardGate()
  if (gate instanceof NextResponse) return gate
  const input = parseCardInput(await req.json().catch(() => null))
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })
  const r = await createCard(gate.svc, input, gate.actor)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, card: r.value })
}
