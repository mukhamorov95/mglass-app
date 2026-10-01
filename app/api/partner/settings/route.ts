import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { recommendedMarkup, normalizeSettingsInput } from '@/lib/partner/counter'
import { previewWriteGuard } from '@/lib/partnerPreview'

// Настройки прилавка партнёра: наценка точки и шапка КП его покупателю.
// Таблица закрыта для браузера (RLS без политик) — только здесь, строго своя строка
// через resolvePartnerClient. Имя и телефон компании — подсказка по умолчанию для шапки,
// наценка по умолчанию — та, при которой покупатель платит наш прайс × 1,25.

type Client = { id: number; name: string; phone: string | null; discount_percent: number | string | null }

async function own() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Не авторизован' }, { status: 401 }) }
  const svc = createServiceClient()
  const client = await resolvePartnerClient<Client>(svc, user.id, 'id,name,phone,discount_percent')
  if (!client) return { error: NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 }) }
  return { svc, client, userId: user.id }
}

export async function GET() {
  const r = await own()
  if ('error' in r) return r.error
  const { data, error } = await r.svc.from('b2b_partner_settings')
    .select('markup_pct,kp_name,kp_phone,kp_note').eq('client_id', r.client.id).maybeSingle()
  if (error) return NextResponse.json({ error: `Настройки не прочитаны: ${error.message}` }, { status: 500 })
  const s = data as { markup_pct: number | string; kp_name: string | null; kp_phone: string | null; kp_note: string | null } | null
  const recommended = recommendedMarkup(Number(r.client.discount_percent) || 0)
  return NextResponse.json({
    linked: true,
    saved: !!s,
    settings: {
      markupPct: s ? Number(s.markup_pct) : recommended,
      kpName: s?.kp_name ?? '', kpPhone: s?.kp_phone ?? '', kpNote: s?.kp_note ?? '',
    },
    defaults: { name: r.client.name, phone: r.client.phone ?? '', markupPct: recommended },
  })
}

export async function POST(req: NextRequest) {
  const r = await own()
  if ('error' in r) return r.error
  const blocked = await previewWriteGuard(r.svc, r.userId, { allowOnTest: true })
  if (blocked) return blocked
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const v = normalizeSettingsInput(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  const { data, error } = await r.svc.from('b2b_partner_settings').upsert({
    client_id: r.client.id,
    markup_pct: v.value.markupPct,
    kp_name: v.value.kpName || null, kp_phone: v.value.kpPhone || null, kp_note: v.value.kpNote || null,
    updated_at: new Date().toISOString(), updated_by: r.userId,
  }, { onConflict: 'client_id' }).select('client_id')
  if (error) return NextResponse.json({ error: `Не сохранено: ${error.message}` }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Не сохранено: база не приняла запись' }, { status: 500 })
  return NextResponse.json({ ok: true, settings: v.value })
}
