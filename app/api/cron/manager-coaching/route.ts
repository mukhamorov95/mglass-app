import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { refreshCoaching } from '@/lib/coaching/store'

// Утренний снимок «Моего дня» для всех менеджеров с графиком. Крон не авторизован
// middleware — проверяет свой секрет сам.
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  try {
    return NextResponse.json({ ok: true, ...await refreshCoaching(createServiceClient()) })
  } catch (e) {
    console.error('[cron/manager-coaching]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
