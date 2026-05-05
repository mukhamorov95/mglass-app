import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await params
  const { stage, done } = await req.json()

  const client = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: order } = await client
    .from('orders')
    .select('production_stages')
    .eq('id', id)
    .single()

  const stages = (order?.production_stages ?? {}) as Record<string, string | null>
  if (done) {
    stages[stage] = new Date().toISOString().slice(0, 10)
  } else {
    delete stages[stage]
  }

  const { error } = await client
    .from('orders')
    .update({ production_stages: stages })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
