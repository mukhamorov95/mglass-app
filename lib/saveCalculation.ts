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
    .insert({ ...payload, created_by: session.user.id, status: 'draft' })
    .select('id')
    .single()

  if (error) {
    return { error: `DB: ${error.message} (code: ${error.code})` }
  }
  return { id: data.id }
}

export async function checkAuth(): Promise<boolean> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return !!session?.user
}
