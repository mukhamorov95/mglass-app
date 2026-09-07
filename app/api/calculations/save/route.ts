import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { getRole } from '@/lib/getRole'
import { checkCalculation, type CalcProductType } from '@/lib/calcInvariants'

export const dynamic = 'force-dynamic'

// Единственная точка записи расчёта. Раньше браузер писал в базу напрямую, и
// правила жили в интерфейсе — то есть в открытой вкладке, которая могла быть
// старше выката. Теперь их держит сервер: одна проверка на все экраны сразу.
//
// service-role взят сознательно: created_by ставим из сессии, а не из тела запроса,
// чтобы расчёт нельзя было записать от чужого имени. Роль проверена выше по коду.

type Body = {
  product_type?: string
  input_data?: Record<string, unknown>
  cost_breakdown?: Record<string, unknown>
  financial_breakdown?: Record<string, unknown>
  base_price?: number
  discount?: number
  partner_percent?: number
  final_price?: number
  margin?: number
  profit?: number
  manager_bonus?: number
  client_text?: string
  notes?: string
  client_name?: string
  client_phone?: string
  order_group_id?: string
  parent_calc_id?: number
  deal_id?: number
}

const TYPES: CalcProductType[] = ['mirror', 'loft', 'shower', 'railing', 'quick', 'build']

async function actor() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Нет активной сессии. Войдите в аккаунт.' }, { status: 401 }) }
  const role = await getRole()
  // Партнёр считает в своём кабинете и в общую историю расчётов не пишет —
  // то же правило, что стояло в RLS.
  if (!role || role === 'partner') {
    return { error: NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 }) }
  }
  return { userId: user.id }
}

export async function POST(req: NextRequest) {
  const a = await actor()
  if ('error' in a) return a.error

  const b = await req.json().catch(() => null) as Body | null
  if (!b) return NextResponse.json({ error: 'Пустое тело запроса' }, { status: 400 })

  const productType = b.product_type as CalcProductType
  if (!TYPES.includes(productType)) {
    return NextResponse.json({ error: `Неизвестный тип расчёта: ${b.product_type}` }, { status: 400 })
  }

  const verdict = checkCalculation({
    product_type: productType,
    final_price: Number(b.final_price),
    base_price: Number(b.base_price),
    margin: Number(b.margin),
    client_name: b.client_name,
    client_phone: b.client_phone,
    deal_id: b.deal_id ?? null,
    input_data: b.input_data,
  })
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 422 })

  const svc = createServiceClient()
  const { data, error } = await svc.from('calculations').insert({
    product_type: productType,
    input_data: b.input_data ?? {},
    cost_breakdown: b.cost_breakdown ?? {},
    financial_breakdown: b.financial_breakdown ?? {},
    base_price: b.base_price ?? 0,
    discount: b.discount ?? 0,
    partner_percent: b.partner_percent ?? 0,
    final_price: b.final_price ?? 0,
    margin: b.margin ?? 0,
    profit: b.profit ?? 0,
    client_text: b.client_text ?? '',
    ...(b.manager_bonus != null ? { manager_bonus: b.manager_bonus } : {}),
    ...(b.notes != null ? { notes: b.notes } : {}),
    ...(b.client_name != null ? { client_name: b.client_name } : {}),
    ...(b.client_phone != null ? { client_phone: b.client_phone } : {}),
    ...(b.order_group_id != null ? { order_group_id: b.order_group_id } : {}),
    ...(b.parent_calc_id != null ? { parent_calc_id: b.parent_calc_id } : {}),
    ...(b.deal_id != null ? { deal_id: b.deal_id } : {}),
    created_by: a.userId,
    status: 'draft',
  }).select('id').single()

  if (error) return NextResponse.json({ error: `DB: ${error.message}` }, { status: 500 })
  return NextResponse.json({ id: data.id })
}

// Правка ранее сохранённого расчёта — через те же инварианты. Менять чужой
// расчёт нельзя: проверяем автора до записи (service-role RLS не применит).
export async function PATCH(req: NextRequest) {
  const a = await actor()
  if ('error' in a) return a.error

  const b = await req.json().catch(() => null) as (Body & { id?: number }) | null
  const id = Number(b?.id)
  if (!b || !Number.isFinite(id)) return NextResponse.json({ error: 'Нужен id расчёта' }, { status: 400 })

  const svc = createServiceClient()
  const { data: existing } = await svc.from('calculations')
    .select('id, created_by, product_type, deal_id').eq('id', id).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Расчёт не найден' }, { status: 404 })

  const role = await getRole()
  const owner = role === 'admin' || role === 'ceo'
  if (!owner && existing.created_by !== a.userId) {
    return NextResponse.json({ error: 'Это чужой расчёт' }, { status: 403 })
  }

  const productType = (b.product_type as CalcProductType) ?? (existing.product_type as CalcProductType)
  const verdict = checkCalculation({
    product_type: productType,
    final_price: Number(b.final_price),
    base_price: Number(b.base_price),
    margin: Number(b.margin),
    client_name: b.client_name,
    client_phone: b.client_phone,
    // Расчёт уже в сделке — клиент известен из карточки.
    deal_id: (existing.deal_id as number | null) ?? b.deal_id ?? null,
    input_data: b.input_data,
  })
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 422 })

  const { error } = await svc.from('calculations').update({
    input_data: b.input_data ?? {},
    cost_breakdown: b.cost_breakdown ?? {},
    financial_breakdown: b.financial_breakdown ?? {},
    base_price: b.base_price ?? 0,
    discount: b.discount ?? 0,
    partner_percent: b.partner_percent ?? 0,
    final_price: b.final_price ?? 0,
    margin: b.margin ?? 0,
    profit: b.profit ?? 0,
    client_text: b.client_text ?? '',
    ...(b.client_name !== undefined ? { client_name: b.client_name } : {}),
    ...(b.client_phone !== undefined ? { client_phone: b.client_phone } : {}),
  }).eq('id', id)

  if (error) return NextResponse.json({ error: `DB: ${error.message}` }, { status: 500 })
  return NextResponse.json({ id })
}
