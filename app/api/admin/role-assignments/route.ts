import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase-server'

async function requireAuth() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, role: null }
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  return { user, role: (data as { role: string } | null)?.role ?? null }
}

export async function GET() {
  const { user } = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await supabase
    .from('role_assignments')
    .select('*, company_roles(id, title, level, sort_order)')
    .eq('active', true)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const { user, role } = await requireAuth()
  if (!user || role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { role_id, first_name, last_name, phone, telegram, email, notes } = body

  if (!role_id || !first_name) {
    return NextResponse.json({ error: 'role_id and first_name required' }, { status: 400 })
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await supabase
    .from('role_assignments')
    .insert({ role_id, first_name, last_name, phone, telegram, email, notes })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
