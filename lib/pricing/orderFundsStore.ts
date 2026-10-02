import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'
import { applyTaxSystem, parseOrderFundRates, type OrderFundRates } from '@/lib/pricing/orderFunds'

export type OrderFundSettings = {
  rates: OrderFundRates
  avgVariablePct: number | null
  targetPct: number | null      // цель «остаётся с заказа» = 100 − средние переменные плана CFO
  taxSource: string | null      // откуда налог: режим из настроек CFO или ставка фонда
  error: string | null
}

// Service-role: у cfo_settings RLS без политик. Роль проверяет вызывающий — только /cfo.
export async function loadOrderFundSettings(): Promise<OrderFundSettings> {
  const svc = createServiceClient()
  const { data, error } = await svc.from('cfo_settings').select('order_funds, avg_variable_pct, tax_system').eq('id', 1).maybeSingle()
  if (error || !data) {
    return { rates: parseOrderFundRates(null), avgVariablePct: null, targetPct: null, taxSource: null, error: error?.message ?? 'нет строки настроек CFO' }
  }
  const avg = Number(data.avg_variable_pct)
  const avgOk = Number.isFinite(avg) && avg > 0 && avg < 100
  const { rates, taxSource } = applyTaxSystem(parseOrderFundRates(data.order_funds), data.tax_system)
  return {
    rates,
    avgVariablePct: avgOk ? avg : null,
    targetPct: avgOk ? 100 - avg : null,
    taxSource,
    error: null,
  }
}
