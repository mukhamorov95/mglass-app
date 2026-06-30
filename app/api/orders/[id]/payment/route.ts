import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/apiAuth'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const guard = await requireRole(['admin', 'ceo', 'manager', 'buyer'])
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const body = await req.json()

  const update: Record<string, unknown> = {
    payment_status:    body.payment_status    ?? 'unpaid',
    prepayment_amount: body.prepayment_amount ?? 0,
    prepayment_date:   body.prepayment_date   ?? null,
    payment_notes:     body.payment_notes?.trim() || null,
  }

  const client = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { error } = await client.from('orders').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
