import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

async function auth() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return null
  return { s, userId: user.id }
}

export async function GET(req: NextRequest) {
  const result = await auth()
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { s } = result
  const { searchParams } = new URL(req.url)
  const segment = searchParams.get('segment')
  const stage   = searchParams.get('stage')

  let q = s.from('b2b_outreach_templates').select('*').eq('active', true).order('segment').order('stage')
  if (segment) q = q.eq('segment', segment)
  if (stage)   q = q.eq('stage', stage)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await auth()
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { s } = result
  const body = await req.json()
  const { data, error } = await s.from('b2b_outreach_templates').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const result = await auth()
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { s } = result
  const { id, ...fields } = await req.json()
  const { error } = await s.from('b2b_outreach_templates').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const result = await auth()
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { s } = result
  const { id } = await req.json()
  const { error } = await s.from('b2b_outreach_templates').update({ active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
