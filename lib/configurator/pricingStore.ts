import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'
import { buildDefaultUnitPrices, migrateUnitPrices, type Tier, type UnitPrices } from '@/lib/configurator/pricing'

// Чтение/запись справочника цен визуализатора (только сервер, service-role).
// Себестоимость НЕ уходит в браузер клиента — читается на сервере при расчёте.
// migrateUnitPrices приводит любую сохранённую форму (старую плоскую или новую
// с подгруппами) к актуальной схеме без потери введённых владельцем цен.

export async function getPricing(tier: Tier): Promise<UnitPrices> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase.from('configurator_pricing').select('data').eq('tier', tier).maybeSingle()
    if (data?.data) return migrateUnitPrices(data.data, tier)
  } catch { /* нет таблицы/строки — дефолты */ }
  return buildDefaultUnitPrices(tier)
}

export async function getAllPricing(): Promise<Record<Tier, UnitPrices>> {
  return { budget: await getPricing('budget'), premium: await getPricing('premium') }
}

export async function savePricing(tier: Tier, data: UnitPrices, updatedBy: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('configurator_pricing').upsert(
    { tier, data, updated_by: updatedBy, updated_at: new Date().toISOString() },
    { onConflict: 'tier' },
  )
  if (error) throw new Error(error.message)
}
