import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const { data, error } = await svc()
    .from('health_fix_log')
    .select('*')
    .order('applied_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const body = await req.json()
  const { fix_id, fix_name, before, applied_by } = body

  const { error } = await svc()
    .from('health_fix_log')
    .insert({ fix_id, fix_name, before, applied_by })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const { error } = await svc().from('health_fix_log').delete().gte('id', '00000000-0000-0000-0000-000000000000')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
