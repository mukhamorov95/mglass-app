import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor, canSeeDeal } from '@/lib/b2c/dealScope'

export const dynamic = 'force-dynamic'

// Заметки по сделке: что обсуждали и о чём договорились. Без них возврат к
// сделке через неделю начинается с нуля, а доска умеет только сказать «тишина».

async function guard(dealId: number) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return { res: actor }
  const svc = createServiceClient()
  const { data: deal } = await svc.from('deals').select('id, created_by, manager_id').eq('id', dealId).maybeSingle()
  if (!deal) return { res: NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 }) }
  if (!canSeeDeal(actor, deal as { created_by: string | null; manager_id: string | null })) {
    return { res: NextResponse.json({ error: 'Нет доступа' }, { status: 403 }) }
  }
  return { actor, svc }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })
  const g = await guard(dealId)
  if ('res' in g) return g.res

  const { data } = await g.svc.from('deal_notes')
    .select('id, text, author_name, created_at')
    .eq('deal_id', dealId).order('created_at', { ascending: false }).limit(100)
  return NextResponse.json({ notes: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })
  const g = await guard(dealId)
  if ('res' in g) return g.res

  const b = await req.json().catch(() => ({})) as { text?: string }
  const text = (b.text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'Пустая заметка' }, { status: 400 })

  const { error } = await g.svc.from('deal_notes').insert({
    deal_id: dealId, text, author_id: g.actor.userId, author_name: g.actor.name,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
