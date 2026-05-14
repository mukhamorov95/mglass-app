import { NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-server'

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await db().from('ai_settings').select('value').eq('key', 'bot_enabled').single()
  const enabled = data?.value !== 'false'
  return NextResponse.json({ enabled })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { enabled } = await req.json()
  await db().from('ai_settings').upsert(
    { key: 'bot_enabled', value: String(enabled), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  )
  return NextResponse.json({ ok: true, enabled })
}
