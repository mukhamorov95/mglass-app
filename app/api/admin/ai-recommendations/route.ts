import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { generateRecommendations, type RecStatus } from '@/lib/ai/recommendations'

// Рекомендации AI Control Center. Только владелец: он принимает решение по каждой.

export const maxDuration = 120

const STATUSES: RecStatus[] = ['new', 'in_work', 'done', 'archived', 'removed']

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const { data, error } = await createServiceClient().from('ai_recommendations')
    .select('*').order('created_at', { ascending: false }).limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// Новая порция рекомендаций по живым данным (кнопка «Получить рекомендации»).
export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const { perspective } = await req.json().catch(() => ({})) as { perspective?: string }
  try {
    const created = await generateRecommendations(createServiceClient(), { perspective: perspective ?? 'ceo', source: 'ai' })
    return NextResponse.json({ created })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Не удалось получить рекомендации' }, { status: 500 })
  }
}

// Решение владельца: в работу / в архив / убрать / сделано (с результатом) / вернуть.
export async function PATCH(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => ({})) as { id?: string; status?: RecStatus; result_note?: string }
  if (!body.id || !body.status || !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Нужны id и решение' }, { status: 400 })
  }
  const { data: { user } } = await (await createClient()).auth.getUser()
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    status: body.status, updated_at: now,
    decided_at: now, decided_by: user?.email ?? null,
  }
  if (body.status === 'done') {
    patch.done_at = now
    if (typeof body.result_note === 'string') patch.result_note = body.result_note.trim().slice(0, 1000) || null
  }
  const { data, error } = await createServiceClient().from('ai_recommendations')
    .update(patch).eq('id', body.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
