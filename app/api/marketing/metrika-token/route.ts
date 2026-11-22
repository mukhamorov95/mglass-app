import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { SITES } from '@/lib/marketing/sites'
import { createServiceClient } from '@/lib/supabase-service'

// Принимает токен, который Яндекс вернул на страницу подключения, проверяет его
// запросом к Метрике и сохраняет. Сам токен в ответ не возвращается никогда.
export async function POST(req: Request) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!/^[A-Za-z0-9_\-.]{20,400}$/.test(token)) return NextResponse.json({ error: 'Яндекс не вернул токен — нажмите «Подключить» ещё раз' }, { status: 400 })

  const res = await fetch('https://api-metrika.yandex.net/management/v1/counters?per_page=1000', { headers: { Authorization: `OAuth ${token}` }, cache: 'no-store' })
  const data = (await res.json().catch(() => ({}))) as { counters?: { id: number }[]; message?: string }
  if (!res.ok) return NextResponse.json({ error: `Метрика не приняла токен (${res.status}): ${data.message ?? 'без пояснения'}` }, { status: 400 })
  const ids = new Set((data.counters ?? []).map((c) => c.id))
  const found = SITES.filter((s) => ids.has(s.metrikaId)).map((s) => s.domain)
  const missing = SITES.filter((s) => !ids.has(s.metrikaId)).map((s) => s.domain)
  if (!found.length) return NextResponse.json({ error: 'У этого аккаунта Яндекса нет доступа ни к одному нашему счётчику — войдите в Яндекс под аккаунтом, где лежат счётчики, и подключите снова' }, { status: 400 })

  const user = await getSessionUser()
  const { data: saved, error } = await createServiceClient()
    .from('integration_tokens')
    .upsert({ key: 'yandex_metrika', token, scope: 'metrika:read', updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
    .select('key')
  if (error || !saved?.length) return NextResponse.json({ error: `Не сохранено: ${error?.message ?? 'база не вернула запись'}` }, { status: 500 })
  return NextResponse.json({ ok: true, found, missing })
}
