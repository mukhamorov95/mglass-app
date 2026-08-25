import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { previewReprice, applyReprice } from '@/lib/supplier/reprice'
import type { Tier } from '@/lib/configurator/pricing'

// Сверка цен комплектов со справочником: GET показывает, что изменилось,
// PUT применяет только подтверждённые позиции. Автоматически ничего не переписываем —
// цена изделия не должна меняться без ведома владельца.
const isTier = (t: string | null): t is Tier => t === 'budget' || t === 'premium'

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const tier = req.nextUrl.searchParams.get('tier')
  if (!isTier(tier)) return NextResponse.json({ error: 'tier: budget|premium' }, { status: 400 })
  return NextResponse.json({ tier, diffs: await previewReprice(tier) })
}

export async function PUT(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => null) as { tier?: string; itemIds?: string[] } | null
  if (!isTier(body?.tier ?? null)) return NextResponse.json({ error: 'tier обязателен' }, { status: 400 })
  const ids = (body?.itemIds ?? []).filter(x => typeof x === 'string')
  if (ids.length === 0) return NextResponse.json({ error: 'нечего применять' }, { status: 400 })
  const { data: { user } } = await (await createClient()).auth.getUser()
  return NextResponse.json(await applyReprice(body!.tier as Tier, ids, user?.email ?? 'owner'))
}
