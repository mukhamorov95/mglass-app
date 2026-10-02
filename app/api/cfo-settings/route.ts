import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'
import { parseOrderFundRates, serializeOrderFundRates } from '@/lib/pricing/orderFunds'

const SETTINGS_FIELDS = ['entity_type', 'tax_system', 'fixed_costs', 'profit_split', 'avg_variable_pct', 'monthly_revenue_target'] as const
const ORDER_FUND_KEYS = Object.keys(serializeOrderFundRates(parseOrderFundRates(null))).filter(k => k !== 'as_of')

export async function POST(req: NextRequest) {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo' && role !== 'cfo') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Пустой запрос' }, { status: 400 })
  }

  // Пишем только пришедшие поля: экран /admin/cfo шлёт свои шесть и о ставках фондов не знает —
  // запись целым набором стёрла бы order_funds.
  const patch: Record<string, unknown> = {}
  for (const k of SETTINGS_FIELDS) if (body[k] !== undefined) patch[k] = body[k]

  if (body.order_funds !== undefined) {
    const raw = body.order_funds
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'order_funds — объект ставок' }, { status: 400 })
    }
    // Ставки приходят набором целиком: недостающий ключ молча стал бы «нет ставки».
    const absent = ORDER_FUND_KEYS.filter(k => !(k in raw))
    if (absent.length) return NextResponse.json({ error: `order_funds: нет ключей ${absent.join(', ')}` }, { status: 400 })
    const asOf = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })
    patch.order_funds = serializeOrderFundRates({ ...parseOrderFundRates(raw), asOf })
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Нечего сохранять' }, { status: 400 })
  }
  patch.updated_at = new Date().toISOString()

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: updated, error } = await supabase
    .from('cfo_settings')
    .update(patch)
    .eq('id', 1)
    .select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!updated?.length) {
    const { error: insErr } = await supabase.from('cfo_settings').insert({ id: 1, ...patch })
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
