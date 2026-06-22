import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isOwnerRole } from '@/lib/getRole'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function requireAuth(req?: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, role: null }
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  return { user, role: (data as { role: string } | null)?.role ?? null }
}

export async function GET() {
  const { user } = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data, error } = await svc().from('brigades').select('*').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { user, role } = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  if (!isOwnerRole(role)) return NextResponse.json({ error: 'Только владелец' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 }) }

  const { data, error } = await svc()
    .from('brigades')
    .insert({
      name:           String(body.name ?? '').trim(),
      lead_name:      body.lead_name  ? String(body.lead_name).trim()  || null : null,
      phone:          body.phone      ? String(body.phone).trim()      || null : null,
      specialization: Array.isArray(body.specialization) ? body.specialization : [],
      active:         body.active ?? true,
      notes:          body.notes      ? String(body.notes).trim()      || null : null,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
