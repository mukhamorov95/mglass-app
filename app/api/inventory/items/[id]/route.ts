import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryWrite } from '@/lib/inventory/auth'
import { updateItem, type ItemInput } from '@/lib/inventory/db'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  const { id } = await params
  try {
    const item = await updateItem(Number(id), await req.json() as ItemInput)
    return NextResponse.json({ item })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

// Карточки не удаляем — журнал движений должен остаться читаемым.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  const { id } = await params
  try {
    await updateItem(Number(id), { active: false })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
