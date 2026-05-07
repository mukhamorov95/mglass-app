import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

async function db() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return null
  return s
}

export async function GET(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  const { data, error } = await s
    .from('marketing_daily_ai')
    .select('*')
    .eq('date', date)
    .order('content_type')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { date, content_type, content } = await req.json()

  const { data, error } = await s
    .from('marketing_daily_ai')
    .upsert({ date, content_type, content }, { onConflict: 'date,content_type' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
