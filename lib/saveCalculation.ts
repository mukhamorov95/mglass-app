import { createClient } from './supabase-browser'

// ── Integrity guard — INV-1, INV-2, INV-4 ────────────────────────────────────
// Проверяет инварианты перед каждым сохранением. Не бросает исключений —
// только console.error, чтобы не ломать UX при граничных случаях.
function assertPayloadIntegrity(p: {
  final_price: number; base_price: number; margin: number
  input_data: Record<string, unknown>; product_type: string
}) {
  // INV-1: final_price >= base_price (иначе final_price = product без услуг, а не grandTotal)
  if (p.final_price > 0 && p.base_price > 0 && p.final_price < p.base_price * 0.8) {
    console.error(
      `[MGlass INV-1] ${p.product_type}: final_price (${p.final_price}) < base_price*0.8 (${Math.round(p.base_price * 0.8)})` +
      ' — вероятно передан finalPrice вместо grandTotal', p
    )
  }
  // INV-4: margin > 90% — признак что profit считается без вычета услуг
  if (p.margin > 90) {
    console.error(`[MGlass INV-4] ${p.product_type}: margin=${p.margin}% > 90% — проверь формулу profit`, p)
  }
  // INV-2: input_data должна содержать хотя бы основные параметры
  const keys = Object.keys(p.input_data ?? {}).length
  if (keys < 4) {
    console.error(`[MGlass INV-2] ${p.product_type}: input_data содержит только ${keys} поля — snapshot неполный`, p)
  }
}

type SavePayload = {
  product_type: 'mirror' | 'loft' | 'shower' | 'railing'
  input_data: Record<string, unknown>
  cost_breakdown: Record<string, unknown>
  financial_breakdown: Record<string, unknown>
  base_price: number
  discount: number
  partner_percent: number
  final_price: number
  margin: number
  profit: number
  manager_bonus?: number
  client_text: string
  notes?: string
  client_name?: string
  client_phone?: string
  order_group_id?: string
  parent_calc_id?: number
}

export type SaveResult = { id: number; error?: never } | { id?: never; error: string } | null

export async function saveCalculation(payload: SavePayload): Promise<SaveResult> {
  assertPayloadIntegrity(payload)
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return { error: 'Нет активной сессии. Войдите в аккаунт.' }
  }

  const { data, error } = await supabase
    .from('calculations')
    .insert({
      ...payload,
      created_by: session.user.id,
      status: 'draft',
      ...(payload.parent_calc_id ? { parent_calc_id: payload.parent_calc_id } : {}),
    })
    .select('id')
    .single()

  if (error) {
    return { error: `DB: ${error.message} (code: ${error.code})` }
  }
  return { id: data.id }
}

export async function updateCalculation(
  id: number,
  payload: Omit<SavePayload, 'order_group_id' | 'client_name' | 'client_phone'> & {
    client_name?: string; client_phone?: string
  },
): Promise<SaveResult> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { error: 'Нет активной сессии.' }

  const { error } = await supabase
    .from('calculations')
    .update({
      input_data:           payload.input_data,
      cost_breakdown:       payload.cost_breakdown,
      financial_breakdown:  payload.financial_breakdown,
      base_price:           payload.base_price,
      discount:             payload.discount,
      partner_percent:      payload.partner_percent,
      final_price:          payload.final_price,
      margin:               payload.margin,
      profit:               payload.profit,
      client_text:          payload.client_text,
      ...(payload.client_name  !== undefined ? { client_name:  payload.client_name  } : {}),
      ...(payload.client_phone !== undefined ? { client_phone: payload.client_phone } : {}),
    })
    .eq('id', id)

  if (error) return { error: `DB: ${error.message} (code: ${error.code})` }
  return { id }
}

export async function checkAuth(): Promise<boolean> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return !!session?.user
}
