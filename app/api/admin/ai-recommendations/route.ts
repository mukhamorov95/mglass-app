import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await svc()
    .from('ai_recommendations')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST: upsert an array of recommendations
export async function POST(req: NextRequest) {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const recs: { id: string; title: string; description?: string; priority: string; category?: string; status: string; source?: string }[] = body

  if (!Array.isArray(recs) || recs.length === 0) return NextResponse.json({ ok: true })

  const { error } = await svc()
    .from('ai_recommendations')
    .upsert(
      recs.map(r => ({
        id:          r.id,
        title:       r.title,
        description: r.description ?? null,
        priority:    r.priority,
        category:    r.category ?? null,
        status:      r.status,
        source:      r.source ?? null,
        updated_at:  new Date().toISOString(),
      })),
      { onConflict: 'id' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await svc().from('ai_recommendations').delete().gte('id', '00000000-0000-0000-0000-000000000000')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
