import { NextRequest, NextResponse } from 'next/server'
import { requireRole, requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Режим приёма лидов в нашу CRM: 'avito_only' (по умолчанию — только Авито-бот)
// или 'all' (плюс зеркало сделок из AmoCRM). Хранится в owner_strategy.
export type IngestMode = 'avito_only' | 'all'

export async function GET() {
  const guard = await requireRole(['admin', 'ceo', 'commercial'])
  if (guard instanceof NextResponse) return guard
  const sb = createServiceClient()
  const { data } = await sb.from('owner_strategy').select('value').eq('key', 'crm_ingest_mode').maybeSingle()
  const mode = ((data as { value: string } | null)?.value ?? 'avito_only') as IngestMode
  return NextResponse.json({ mode })
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  let body: { mode?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const mode = body.mode
  if (mode !== 'avito_only' && mode !== 'all') return NextResponse.json({ error: 'mode должен быть avito_only|all' }, { status: 400 })
  const sb = createServiceClient()
  const { error } = await sb.from('owner_strategy').upsert({ key: 'crm_ingest_mode', value: mode }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mode })
}
