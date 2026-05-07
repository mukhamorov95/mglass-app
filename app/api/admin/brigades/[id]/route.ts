import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await params
  const body   = await req.json()

  const update: Record<string, unknown> = {}
  if (body.name           !== undefined) update.name           = body.name?.trim()
  if (body.lead_name      !== undefined) update.lead_name      = body.lead_name?.trim()  || null
  if (body.phone          !== undefined) update.phone          = body.phone?.trim()      || null
  if (body.specialization !== undefined) update.specialization = body.specialization     ?? []
  if (body.active         !== undefined) update.active         = body.active
  if (body.notes          !== undefined) update.notes          = body.notes?.trim()      || null

  const { error } = await svc().from('brigades').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
