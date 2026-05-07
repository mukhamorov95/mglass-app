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
  const status = searchParams.get('status')
  const topic = searchParams.get('topic')
  const content_type = searchParams.get('content_type')

  let q = s.from('marketing_scripts').select('*').order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  if (topic) q = q.eq('topic', topic)
  if (content_type) q = q.eq('content_type', content_type)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user } } = await s.auth.getUser()
  const body = await req.json()
  const { data, error } = await s
    .from('marketing_scripts')
    .insert({ ...body, created_by: user!.id })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, ...fields } = await req.json()
  const { error } = await s.from('marketing_scripts').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  const { error } = await s.from('marketing_scripts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
