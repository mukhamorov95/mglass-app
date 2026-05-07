import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const { data, error } = await svc()
    .from('suppliers')
    .select('*')
    .order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const body = await req.json()
  const { data, error } = await svc()
    .from('suppliers')
    .insert({
      name:      body.name?.trim(),
      contact:   body.contact?.trim() || null,
      phone:     body.phone?.trim()   || null,
      email:     body.email?.trim()   || null,
      materials: body.materials?.trim() || null,
      notes:     body.notes?.trim()   || null,
      active:    body.active ?? true,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
