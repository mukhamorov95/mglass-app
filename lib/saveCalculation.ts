import { createClient } from './supabase-browser'

type SavePayload = {
  product_type: 'mirror' | 'loft' | 'shower'
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
