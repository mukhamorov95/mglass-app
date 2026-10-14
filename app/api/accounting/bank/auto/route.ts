import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { FIN_ROLES } from '@/lib/accounting/roles'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { autoApplyBank } from '@/lib/accounting/bankAuto'

// Оплаты заказов по загруженной выписке — уверенные совпадения, без человека. Вкладка
// «Выписка» зовёт после загрузки и повторяет, пока more: true.

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({}))
  const unit = body?.unit === 'ooo' ? 'ooo' : 'ip'

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { data: me } = await sb.from('users').select('name').eq('id', user?.id ?? '').maybeSingle()

  try {
    const res = await autoApplyBank(createServiceClient(), unit, (me as { name?: string } | null)?.name ?? null, { dry: body?.dry === true })
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    return NextResponse.json({ error: `Оплаты по выписке не проставлены: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
