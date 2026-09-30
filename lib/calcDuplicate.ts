import { checkCalculation, CALC_PRODUCT_TYPES, type CalcProductType } from '@/lib/calcInvariants'

// Строка списка /calculations: копия возвращается в той же форме, что и список.
export const CALC_LIST_COLS =
  'id,created_at,created_by,product_type,input_data,cost_breakdown,financial_breakdown,base_price,discount,partner_percent,final_price,margin,profit,manager_bonus,status,client_text,client_name,client_phone,order_group_id,order_number'

export const DUPLICATE_SOURCE_COLS =
  'id,created_by,product_type,input_data,cost_breakdown,financial_breakdown,base_price,discount,partner_percent,final_price,margin,profit,manager_bonus,client_text,client_name,client_phone'

export type DuplicateSource = {
  id: number
  created_by: string | null
  product_type: string
  input_data: Record<string, unknown> | null
  cost_breakdown: Record<string, unknown> | null
  financial_breakdown: Record<string, unknown> | null
  base_price: number | null
  discount: number | null
  partner_percent: number | null
  final_price: number | null
  margin: number | null
  profit: number | null
  manager_bonus: number | null
  client_text: string | null
  client_name: string | null
  client_phone: string | null
}

export type DuplicateResult = { ok: true; row: Record<string, unknown> } | { ok: false; error: string }

// Копия — новый черновик того, кто нажал, через те же инварианты, что и сохранение.
// Сделка, заказ и номер заказа не копируются: копия — отдельный расчёт, а не
// пересчёт (у пересчёта parent_calc_id и своя пометка в карточке сделки).
export function buildDuplicate(src: DuplicateSource, userId: string): DuplicateResult {
  const type = src.product_type as CalcProductType
  if (!CALC_PRODUCT_TYPES.includes(type)) {
    return { ok: false, error: `Тип расчёта «${src.product_type}» больше не сохраняется — посчитайте заново` }
  }

  const verdict = checkCalculation({
    product_type: type,
    final_price: Number(src.final_price),
    base_price: Number(src.base_price),
    margin: Number(src.margin),
    client_name: src.client_name ?? undefined,
    client_phone: src.client_phone ?? undefined,
    deal_id: null,
    input_data: src.input_data ?? undefined,
  })
  if (!verdict.ok) return verdict

  return {
    ok: true,
    row: {
      product_type: type,
      input_data: src.input_data ?? {},
      cost_breakdown: src.cost_breakdown ?? {},
      financial_breakdown: src.financial_breakdown ?? {},
      base_price: src.base_price ?? 0,
      discount: src.discount ?? 0,
      partner_percent: src.partner_percent ?? 0,
      final_price: src.final_price ?? 0,
      margin: src.margin ?? 0,
      profit: src.profit ?? 0,
      client_text: src.client_text ?? '',
      ...(src.manager_bonus != null ? { manager_bonus: src.manager_bonus } : {}),
      ...(src.client_name != null ? { client_name: src.client_name } : {}),
      ...(src.client_phone != null ? { client_phone: src.client_phone } : {}),
      created_by: userId,
      status: 'draft',
    },
  }
}
