import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// A7: партнёр сам ведёт свои юрлица (реквизиты для счёта/договора). Строго свои.
// Эти же реквизиты подставляются в счёт-спецификацию (A1). Основное юрлицо
// зеркалится в плоские колонки b2b_clients (совместимость с пакетным счётом).

const COLS = 'id,full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date,is_default,active'
const FIELDS = ['full_name', 'inn', 'kpp', 'ogrn', 'legal_address', 'bank_account', 'bank_name', 'bik', 'corr_account', 'supply_contract_no', 'supply_contract_date'] as const

function svcClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
async function ownClient(svc: ReturnType<typeof svcClient>, userId: string) {
  const { data } = await svc.from('b2b_clients').select('id,organization_id').eq('user_id', userId).maybeSingle()
  return data
}
function pick(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of FIELDS) if (f in body) {
    const v = body[f]
    out[f] = (typeof v === 'string' && v.trim() === '') ? null : v
  }
  return out
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = svcClient()
  const client = await ownClient(svc, user.id)
  if (!client) return NextResponse.json({ linked: false, entities: [] })
  const { data } = await svc.from('b2b_client_legal_entities').select(COLS)
    .eq('client_id', client.id).eq('active', true)
    .order('is_default', { ascending: false }).order('id', { ascending: true })
  return NextResponse.json({ linked: true, entities: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = svcClient()
  const client = await ownClient(svc, user.id)
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const fields = pick(body)
  if (!fields.full_name && !body.id) return NextResponse.json({ error: 'Укажите наименование' }, { status: 400 })
  const entId = Number(body.id) || null
  const org = (client.organization_id as number | null) ?? 1

  let isDefault = false
  let savedId = entId
  if (entId) {
    const { data: cur } = await svc.from('b2b_client_legal_entities').select('is_default,client_id').eq('id', entId).maybeSingle()
    if (!cur || (cur.client_id as number) !== client.id) return NextResponse.json({ error: 'Юрлицо не найдено' }, { status: 404 })
    isDefault = !!cur.is_default
    const { error } = await svc.from('b2b_client_legal_entities').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', entId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { count } = await svc.from('b2b_client_legal_entities').select('id', { count: 'exact', head: true }).eq('client_id', client.id).eq('active', true)
    isDefault = (count ?? 0) === 0
    const { data: ins, error } = await svc.from('b2b_client_legal_entities')
      .insert({ client_id: client.id, organization_id: org, ...fields, is_default: isDefault, active: true })
      .select('id').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    savedId = (ins?.id as number | null) ?? null
  }
  if (isDefault) await svc.from('b2b_clients').update(fields).eq('id', client.id)
  return NextResponse.json({ ok: true, id: savedId })
}
