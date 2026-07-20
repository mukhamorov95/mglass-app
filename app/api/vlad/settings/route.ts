import { NextRequest, NextResponse } from 'next/server'
import { vladDb, requireVlad } from '@/lib/vlad/vladClient'

// Настройки личного контура: пока — ссылка на календарь (секрет ICS-фида).
export async function GET(req: NextRequest) {
  const gate = await requireVlad(req)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })
  const { data } = await db.from('vlad_settings').select('value').eq('key', 'ics_secret').single()
  const secret = typeof data?.value === 'string' ? data.value : null
  return NextResponse.json({ ics_secret: secret })
}
