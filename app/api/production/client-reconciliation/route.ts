import { NextRequest, NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { getSessionUser, getUserProfile } from '@/lib/getRole'
import { serviceAsMe } from '@/lib/serviceAs'
import { createServiceClient } from '@/lib/supabase-service'
import { isDayKey, presetPeriod } from '@/lib/b2b/clientReport'
import { mskDayKey } from '@/lib/time'

import { CLIENT, history, loadDoc, type Svc } from '@/lib/production/clientReconciliationRead'

// Акт сверки: чтение и запись только здесь и только тем, кому положено видеть деньги. Себестоимости в ответе нет.
// Клиент пока один, расчёт от него не зависит: другого клиента добавит одна строка.

const PAGE = '/production-app/shower-glass'
async function guardMoney() {
  const guard = await requirePageAccess(PAGE)
  if (guard instanceof NextResponse) return guard
  const profile = await getUserProfile()
  if (profile?.canViewMoney !== true) return NextResponse.json({ error: 'Акт сверки видят те, кому открыты деньги.' }, { status: 403 })
  return null
}

export async function GET(req: NextRequest) {
  const denied = await guardMoney()
  if (denied) return denied
  const svc = createServiceClient()
  const url = new URL(req.url)
  try {
    const id = Number(url.searchParams.get('id'))
    if (id > 0) {
      const { data, error } = await svc.from('client_reconciliations').select('id, snapshot, created_at, created_by_name').eq('id', id).eq('client_id', CLIENT.id).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return NextResponse.json({ error: 'Такого акта нет.' }, { status: 404 })
      return NextResponse.json(data)
    }
    const today = mskDayKey()
    const fallback = presetPeriod('month', today)
    const from = url.searchParams.get('from') ?? fallback.from
    const to = url.searchParams.get('to') ?? fallback.to
    if (!isDayKey(from) || !isDayKey(to) || from > to) return NextResponse.json({ error: 'Проверьте даты периода.' }, { status: 400 })
    const [doc, list] = await Promise.all([loadDoc(svc, from, to), history(svc)])
    return NextResponse.json({ today, doc, history: list })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка загрузки' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardMoney()
  if (denied) return denied
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { action?: string; from?: string; to?: string; id?: number }
  const svc = await serviceAsMe()
  try {
    if (body.action === 'save') {
      if (!isDayKey(body.from) || !isDayKey(body.to) || body.from > body.to) return NextResponse.json({ error: 'Проверьте даты периода.' }, { status: 400 })
      const doc = await loadDoc(svc as unknown as Svc, body.from, body.to)
      const { data: prof } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
      const { data, error } = await svc.from('client_reconciliations').insert({
        client_id: CLIENT.id, date_from: body.from, date_to: body.to, snapshot: doc, created_by: user.id,
        created_by_name: (prof as { name: string | null } | null)?.name ?? user.email ?? null,
      }).select('id').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, id: (data as { id: number }).id })
    }
    if (body.action === 'delete') {
      const { data, error } = await svc.from('client_reconciliations').delete().eq('id', Number(body.id)).eq('client_id', CLIENT.id).select('id')
      if (error) throw new Error(error.message)
      if (!data?.length) return NextResponse.json({ error: 'Такого акта нет.' }, { status: 404 })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка записи' }, { status: 500 })
  }
}
