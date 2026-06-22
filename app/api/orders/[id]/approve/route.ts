import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isOwnerRole } from '@/lib/getRole'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  // Owner-tier (admin + ceo) can approve over-discount orders
  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!isOwnerRole(userRow?.role)) {
    return NextResponse.json({ error: 'Только владелец может одобрять заказы' }, { status: 403 })
  }

  const { id } = await params
  const { approval_notes } = await req.json().catch(() => ({}))

  // Use service role to bypass RLS (admin is approving someone else's order)
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { error } = await admin
    .from('orders')
    .update({
      status:         'in_work',
      approved_by:    user.id,
      approved_at:    new Date().toISOString(),
      approval_notes: approval_notes?.trim() || null,
      launched_at:    new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', ['pending_approval'])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
