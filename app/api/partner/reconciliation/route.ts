import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { denyUnless, resolvePartnerMember } from '@/lib/partnerClient'
import { isDayKey, presetPeriod } from '@/lib/b2b/clientReport'
import { CLIENT, history, loadDoc } from '@/lib/production/clientReconciliationRead'
import { mskDayKey } from '@/lib/time'

// Акт сверки в кабинете: тот же расчёт, что у нас на экране Шовер Гласс, и наши сохранённые акты.
// Только чтение и только роли с «финансами» (руководитель, бухгалтер).

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = createServiceClient()
  const pm = await resolvePartnerMember<{ id: number }>(svc, user.id, 'id')
  if (!pm) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })
  { const denied = denyUnless(pm.role, 'finance'); if (denied) return denied }
  if (pm.client.id !== CLIENT.id) return NextResponse.json({ available: false })

  const url = new URL(req.url)
  try {
    const id = Number(url.searchParams.get('id'))
    if (id > 0) {
      const { data, error } = await svc.from('client_reconciliations').select('id, snapshot, created_at')
        .eq('id', id).eq('client_id', CLIENT.id).maybeSingle()
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
    return NextResponse.json({ available: true, today, doc, history: list.map(h => ({ ...h, created_by_name: undefined })) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка загрузки' }, { status: 500 })
  }
}
