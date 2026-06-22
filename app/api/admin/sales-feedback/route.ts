import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'
import { createClient as createServerClient } from '@/lib/supabase-server'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const { searchParams } = new URL(req.url)
  const rating = searchParams.get('rating')
  let q = adminClient().from('ai_sales_feedback').select('*').order('created_at', { ascending: false }).limit(200)
  if (rating) q = q.eq('rating', rating)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { error } = await adminClient().from('ai_sales_feedback').insert({
    ...body,
    created_by: user.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
