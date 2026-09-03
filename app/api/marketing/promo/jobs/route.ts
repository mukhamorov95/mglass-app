import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Список заданий и правка стадии/результата. Правит владелец или оркестратор,
// когда кадры сгенерированы и сложены.
export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const sb = createServiceClient()
  const { data, error } = await sb.from('promo_jobs').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const b = await req.json().catch(() => ({}))
  const id = Number(b.id)
  if (!id) return NextResponse.json({ error: 'Не указано задание' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof b.stage === 'string') patch.stage = b.stage
  if (typeof b.result_url === 'string') patch.result_url = b.result_url
  if (typeof b.note === 'string') patch.note = b.note
  if (Array.isArray(b.shots)) patch.shots = b.shots

  const sb = createServiceClient()
  const { error } = await sb.from('promo_jobs').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
