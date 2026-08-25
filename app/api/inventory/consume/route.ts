import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryRead, requireInventoryWrite } from '@/lib/inventory/auth'
import { buildConsumePlan, applyConsume } from '@/lib/inventory/db'
import type { DocType, PlanRow } from '@/lib/inventory/types'

export const runtime = 'nodejs'

// Предпросмотр: что именно уйдёт со склада по этому заказу. Ничего не меняет.
export async function GET(req: NextRequest) {
  const actor = await requireInventoryRead()
  if (actor instanceof NextResponse) return actor
  const p = req.nextUrl.searchParams
  const docType = p.get('type') as DocType | null
  const docId   = p.get('id')
  if (!docType || !docId) return NextResponse.json({ error: 'Нужны type и id документа' }, { status: 400 })
  try {
    return NextResponse.json({ plan: await buildConsumePlan(docType, docId) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  try {
    const body = await req.json() as { type: DocType; id: string; rows?: PlanRow[] }
    const plan = await buildConsumePlan(body.type, body.id)
    if (plan.already) return NextResponse.json({ error: 'По этому документу уже списывали', inserted: 0 }, { status: 409 })
    return NextResponse.json(await applyConsume(plan, actor, body.rows))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
