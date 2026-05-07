import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

async function db() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return null
  return s
}

export async function GET() {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await s.from('marketing_videos').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user } } = await s.auth.getUser()
  const body = await req.json()
  const { data, error } = await s.from('marketing_videos').insert({ ...body, created_by: user!.id }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, ...fields } = await req.json()
  const { error } = await s.from('marketing_videos').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  const { error } = await s.from('marketing_videos').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
