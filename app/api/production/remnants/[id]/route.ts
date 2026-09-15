import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryWrite } from '@/lib/inventory/auth'
import { createServiceClient } from '@/lib/supabase-service'

export const runtime = 'nodejs'

// Остаток на стеллаже: переложить (место), списать в лом или вернуть на стеллаж.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInventoryWrite()
  if (actor instanceof NextResponse) return actor
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { status?: 'in_stock' | 'scrapped'; location?: string | null }
  const svc = createServiceClient()

  const patch: Record<string, unknown> = {}
  if (body.location !== undefined) patch.location = body.location?.trim().slice(0, 60) || null
  if (body.status === 'scrapped' || body.status === 'in_stock') {
    const { data: me } = await svc.from('users').select('name').eq('id', actor.userId).maybeSingle()
    patch.status = body.status
    patch.closed_by_name = body.status === 'scrapped' ? ((me?.name as string | undefined) || actor.name || null) : null
    patch.closed_at = body.status === 'scrapped' ? new Date().toISOString() : null
    if (body.status === 'in_stock') patch.used_cut_id = null
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Нечего менять' }, { status: 400 })

  const { data, error } = await svc.from('sheet_remnants').update(patch).eq('id', Number(id)).select('id, code, status, location').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Остаток не найден' }, { status: 404 })
  return NextResponse.json({ remnant: data })
}
