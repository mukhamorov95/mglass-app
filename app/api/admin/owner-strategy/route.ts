import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const { data, error } = await adminClient()
    .from('owner_strategy')
    .select('key, value')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const map: Record<string, string> = {}
  for (const row of data ?? []) map[row.key] = row.value ?? ''
  return NextResponse.json(map)
}

export async function PUT(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const body: Record<string, string> = await req.json()

  const upserts = Object.entries(body).map(([key, value]) => ({
    key,
    value: String(value),
    updated_at: new Date().toISOString(),
  }))

  const { error } = await adminClient()
    .from('owner_strategy')
    .upsert(upserts, { onConflict: 'key' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
