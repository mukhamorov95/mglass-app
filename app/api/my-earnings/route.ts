import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPageAccess } from '@/lib/apiAuth'
import { getSessionUser, isOwnerRole } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { loadCash } from '@/lib/earnings/cashData'
import { loadMorning } from '@/lib/morningData'
import { mskDayKey } from '@/lib/time'

export const dynamic = 'force-dynamic'

// «Мои деньги» по кассе (решение владельца 05.10, М5): поступления менеджера из
// «Аналитики дохода». Менеджер получает только себя — amo-id из учётки, не из адреса;
// владелец — любого по ?m= и команду текущего месяца для рейтинга.

export async function GET(req: NextRequest) {
  const guard = await requireAnyPageAccess(['/my-earnings'])
  if (guard instanceof NextResponse) return guard
  const role = guard
  const owner = isOwnerRole(role)

  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Нужно войти' }, { status: 401 })
  const { data: me } = await (await createClient()).from('users').select('amo_user_id').eq('id', user.id).maybeSingle()

  const m = new URL(req.url).searchParams.get('m')
  const target = owner && m && /^\d+$/.test(m) ? Number(m) : me?.amo_user_id != null ? Number(me.amo_user_id) : null

  const today = mskDayKey()
  const sb = createServiceClient()
  const [cash, team] = await Promise.all([
    target != null ? loadCash(sb, { today, amoUserId: target }) : null,
    owner ? loadMorning(sb, { today }) : null,
  ])

  return NextResponse.json({
    role,
    cash,
    team: team && {
      month: team.month,
      bookLastDay: team.bookLastDay,
      people: team.people.map(p => ({
        amoUserId: p.amoUserId, name: p.name, plan: p.plan,
        cash: p.month.prepay + p.month.remainder, payments: p.month.payments,
      })),
      errors: team.errors,
    },
  })
}
