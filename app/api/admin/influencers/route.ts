import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

async function admin() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return null
  return s
}

export async function GET(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') // 'influencer' | 'campaign'
  const influencer_id = searchParams.get('influencer_id')

  if (type === 'campaign') {
    let q = s.from('influencer_campaigns')
      .select('*, influencers(name, platform, handle)')
      .order('created_at', { ascending: false })
    if (influencer_id) q = q.eq('influencer_id', parseInt(influencer_id))
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  const { data, error } = await s
    .from('influencers')
    .select('*')
    .order('followers', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const table = body._type === 'campaign' ? 'influencer_campaigns' : 'influencers'
  const { _type, ...fields } = body
  const { data, error } = await s.from(table).insert(fields).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, _type, ...fields } = await req.json()
  const table = _type === 'campaign' ? 'influencer_campaigns' : 'influencers'
  const { error } = await s.from(table).update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, _type } = await req.json()
  const table = _type === 'campaign' ? 'influencer_campaigns' : 'influencers'
  const { error } = await s.from(table).delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
