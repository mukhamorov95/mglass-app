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
  product_type: 'mirror' | 'loft' | 'shower' | 'railing' | 'quick' | 'build'
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

// Пишем через сервер, а не напрямую в базу: инварианты (клиент у продающего
// расчёта, вменяемая маржа, автор из сессии) должны действовать одинаково для
// всех вкладок, включая открытые до выката. См. lib/calcInvariants.ts.
async function post(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<SaveResult> {
  try {
    const r = await fetch(path, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => null) as { id?: number; error?: string } | null
    if (!r.ok) return { error: j?.error ?? `Ошибка сохранения (${r.status})` }
    if (!j?.id) return { error: 'Сервер не вернул номер расчёта' }
    return { id: j.id }
  } catch {
    return { error: 'Нет связи с сервером — расчёт не сохранён' }
  }
}

export async function saveCalculation(payload: SavePayload): Promise<SaveResult> {
  assertPayloadIntegrity(payload)
  return post('/api/calculations/save', 'POST', payload)
}

export async function updateCalculation(
  id: number,
  payload: Omit<SavePayload, 'order_group_id' | 'client_name' | 'client_phone'> & {
    client_name?: string; client_phone?: string
  },
): Promise<SaveResult> {
  return post('/api/calculations/save', 'PATCH', { ...payload, id })
}

export async function checkAuth(): Promise<boolean> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return !!session?.user
}
