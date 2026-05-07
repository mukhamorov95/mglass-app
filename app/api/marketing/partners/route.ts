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
  const withReferrals = searchParams.get('referrals') === '1'

  if (withReferrals) {
    const { data, error } = await s
      .from('marketing_partners')
      .select('*, marketing_partner_referrals(*)')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  const { data, error } = await s.from('marketing_partners').select('*').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()

  if (body._type === 'referral') {
    const { _type, ...fields } = body
    const { data, error } = await s.from('marketing_partner_referrals').insert(fields).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  const { data, error } = await s.from('marketing_partners').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, _type, ...fields } = await req.json()
  const table = _type === 'referral' ? 'marketing_partner_referrals' : 'marketing_partners'
  const { error } = await s.from(table).update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, _type } = await req.json()
  const table = _type === 'referral' ? 'marketing_partner_referrals' : 'marketing_partners'
  const { error } = await s.from(table).delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
