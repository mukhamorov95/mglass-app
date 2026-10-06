import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { runLiveChecks } from '@/lib/health/liveChecks'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// «Всё ли работает» для AI Control Center: живые проверки, только владельцу.
export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const checks = await runLiveChecks(createServiceClient())
  return NextResponse.json({ checks, at: new Date().toISOString() })
}
