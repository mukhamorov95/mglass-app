import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { listVersions, publishVersion } from '@/lib/configurator/priceVersion'

// Версии прайса: GET — список опубликованных, POST — заморозить текущий прайс версией.
// Себестоимость внутри снимка, поэтому только владелец/логист.
export async function GET() {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  return NextResponse.json({ versions: await listVersions() })
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => null) as { label?: string; validDays?: number } | null
  const { data: { user } } = await (await createClient()).auth.getUser()
  const meta = await publishVersion(body?.label ?? '', body?.validDays ?? 30, user?.email ?? 'owner')
  return NextResponse.json({ ok: true, version: meta })
}
