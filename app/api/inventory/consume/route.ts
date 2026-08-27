import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryRead, requireInventoryWrite } from '@/lib/inventory/auth'
import { buildConsumePlan, applyConsume } from '@/lib/inventory/db'
import type { DocType, PlanRow, MoveOrigin } from '@/lib/inventory/types'

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
    const body = await req.json() as { type: DocType; id: string; rows?: PlanRow[]; origin?: MoveOrigin }
    const plan = await buildConsumePlan(body.type, body.id)
    // «Уже списано» и «нечего списывать» — не ошибки, а нормальные исходы: даём
    // 200 с флагами, чтобы автосписание из цеха не выглядело сбоем в логах.
    if (plan.already) {
      return NextResponse.json({ inserted: 0, released: 0, skipped: 0, alreadyConsumed: true })
    }
    const res = await applyConsume(plan, actor, body.rows, body.origin ?? 'fact')
    return NextResponse.json({ ...res, alreadyConsumed: false })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
