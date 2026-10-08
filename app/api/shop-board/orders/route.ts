import { NextRequest, NextResponse } from 'next/server'
import { boardGate } from '@/lib/shopBoard/auth'
import { searchOrders } from '@/lib/shopBoard/server'
import { canCreateCard } from '@/lib/shopBoard/model'

// Поиск заказа для поручения — только тем, кто ставит поручения. Номер, клиент, срок; без сумм.
export async function GET(req: NextRequest) {
  const gate = await boardGate()
  if (gate instanceof NextResponse) return gate
  if (!canCreateCard(gate.actor.role, gate.actor.permissions)) return NextResponse.json({ error: 'Нет права ставить поручения' }, { status: 403 })
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 60)
  try {
    return NextResponse.json({ orders: await searchOrders(gate.svc, q) })
  } catch (e) {
    return NextResponse.json({ error: `Заказы не прочитались: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
