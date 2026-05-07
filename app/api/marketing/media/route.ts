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
  const tag = searchParams.get('tag')
  const category = searchParams.get('category')
  const type = searchParams.get('type')

  let q = s.from('marketing_media').select('*').order('created_at', { ascending: false })
  if (category) q = q.eq('category', category)
  if (type) q = q.eq('type', type)
  if (tag) q = q.contains('tags', [tag])

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
    .from('marketing_media')
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
  const { error } = await s.from('marketing_media').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  const { error } = await s.from('marketing_media').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
