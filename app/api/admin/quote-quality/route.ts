import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import type { QualityRow } from '@/lib/b2b/quoteQuality'

export const dynamic = 'force-dynamic'

// Полнота просчёта — только владельцу (admin/ceo): экран называет менеджеров
// поимённо. Разворот jsonb-массива позиций делает Postgres
// (`quote_quality_weekly`), сюда приходят готовые счётчики по неделям.

const DEFAULT_FROM = '2026-07-01'

export async function GET(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const from = req.nextUrl.searchParams.get('from') ?? DEFAULT_FROM
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: 'from: ожидается YYYY-MM-DD' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db.rpc('quote_quality_weekly', { p_from: from })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ from, rows: (data ?? []) as QualityRow[] })
}
