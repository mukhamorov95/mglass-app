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
  const type = searchParams.get('type')
  const lead_id = searchParams.get('lead_id')
  const status = searchParams.get('status')
  const segment = searchParams.get('segment')

  if (type === 'activity' && lead_id) {
    const { data, error } = await s
      .from('b2b_lead_activities')
      .select('*')
      .eq('lead_id', parseInt(lead_id))
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  let q = s.from('b2b_leads').select('*').order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  if (segment) q = q.eq('segment', segment)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await auth()
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { s, userId } = result
  const body = await req.json()
  const { _type, ...fields } = body

  if (_type === 'activity') {
    const { data, error } = await s
      .from('b2b_lead_activities')
      .insert({ ...fields, created_by: userId })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (fields.lead_id) {
      await s.from('b2b_leads').update({ last_contact_date: new Date().toISOString().slice(0, 10) }).eq('id', fields.lead_id)
    }
    return NextResponse.json(data)
  }

  if (_type === 'bulk') {
    const leads = (fields.leads as object[]).map((l: object) => ({ ...(l as Record<string, unknown>), created_by: userId }))
    const { data, error } = await s.from('b2b_leads').insert(leads).select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, count: data.length })
  }

  const { data, error } = await s
    .from('b2b_leads')
    .insert({ ...fields, created_by: userId })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const result = await auth()
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { s } = result
  const { id, _type, ...fields } = await req.json()
  const table = _type === 'activity' ? 'b2b_lead_activities' : 'b2b_leads'
  const { error } = await s.from(table).update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const result = await auth()
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { s } = result
  const { id, _type } = await req.json()
  const table = _type === 'activity' ? 'b2b_lead_activities' : 'b2b_leads'
  const { error } = await s.from(table).delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
