import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { FIN_ROLES } from '@/lib/accounting/roles'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { autoApplyBank } from '@/lib/accounting/bankAuto'
import { allocateAdvances } from '@/lib/accounting/clientAdvance'
import { recentPaidSince, syncPaidStages } from '@/lib/b2b/paidStage'

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
    const svc = createServiceClient()
    const res = await autoApplyBank(svc, unit, (me as { name?: string } | null)?.name ?? null, { dry: body?.dry === true })
    // Банк оплатил заказ, уже списанный с аванса, — списание возвращается в остаток аванса
    if (res.applied.length) {
      try { res.warnings.push(...(await allocateAdvances(svc)).warnings) } catch (e) {
        res.warnings.push(`Авансы не пересчитаны: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    // Деньги пришли — этап «Оплачен» в заказах датой выписки (lib/b2b/paidStage)
    let stages = 0
    if (body?.dry !== true) {
      try {
        const st = await syncPaidStages(svc, { paidSince: recentPaidSince() })
        stages = st.changed.length
        res.warnings.push(...st.warnings)
      } catch (e) {
        res.warnings.push(`Этап «Оплачен» не обновлён: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return NextResponse.json({ ok: true, ...res, stages })
  } catch (e) {
    return NextResponse.json({ error: `Оплаты по выписке не проставлены: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
