import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'
import { getPricing } from '@/lib/configurator/pricingStore'
import { M_MODELS, getModel } from '@/lib/configurator/arrangement'
import {
  emptyLibrary, libraryFromUnitPrices, defaultKitFor, emptyKit,
  type Library, type ModelKit, type KitRates,
} from '@/lib/configurator/kit'
import type { Tier } from '@/lib/configurator/pricing'

// Чтение/запись прайса по моделям. Только сервер (service-role): себестоимость в браузер
// клиента не уходит, расчёт делает /api/configurator/quote.
// Первое открытие тарифа переносит то, что уже набито в старой схеме подгрупп, —
// позиции становятся библиотекой, комплекты моделей собираются по геометрии.

export async function getLibrary(tier: Tier): Promise<{ library: Library; rates: KitRates; seeded: boolean }> {
  const legacy = await getPricing(tier)
  const rates: KitRates = {
    glassPerM2: legacy.glassPerM2,
    installPerSection: legacy.installPerSection,
    deliveryMoscow: legacy.deliveryMoscow,
    liftPerFloor: legacy.liftPerFloor,
  }
  try {
    const supabase = createServiceClient()
    const { data } = await supabase.from('configurator_library').select('items, rates').eq('tier', tier).maybeSingle()
    if (data?.items && Array.isArray(data.items) && data.items.length > 0) {
      return { library: { items: data.items }, rates: { ...rates, ...(data.rates ?? {}) }, seeded: false }
    }
  } catch { /* таблицы ещё нет — отдаём перенос из старой схемы */ }
  return { library: libraryFromUnitPrices(legacy), rates, seeded: true }
}

export async function saveLibrary(tier: Tier, library: Library, rates: KitRates, updatedBy: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('configurator_library').upsert(
    { tier, items: library.items, rates, updated_by: updatedBy, updated_at: new Date().toISOString() },
    { onConflict: 'tier' },
  )
  if (error) throw new Error(error.message)
}

export async function getKit(tier: Tier, code: string, library: Library): Promise<{ kit: ModelKit; seeded: boolean }> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase.from('configurator_model_kits').select('kit').eq('tier', tier).eq('model_code', code).maybeSingle()
    const slots = (data?.kit as ModelKit | null)?.slots
    if (Array.isArray(slots)) return { kit: { slots }, seeded: false }
  } catch { /* таблицы ещё нет */ }
  const model = M_MODELS.some(m => m.code === code) ? getModel(code) : null
  return { kit: model ? defaultKitFor(model, library) : emptyKit(), seeded: true }
}

export async function getAllKits(tier: Tier, library: Library): Promise<Record<string, ModelKit>> {
  const out: Record<string, ModelKit> = {}
  for (const m of M_MODELS) out[m.code] = (await getKit(tier, m.code, library)).kit
  return out
}

export async function saveKit(tier: Tier, code: string, kit: ModelKit, updatedBy: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('configurator_model_kits').upsert(
    { tier, model_code: code, kit, updated_by: updatedBy, updated_at: new Date().toISOString() },
    { onConflict: 'tier,model_code' },
  )
  if (error) throw new Error(error.message)
}

// Сохранить ВСЕ комплекты тарифа разом. Нужно, потому что правки «во все модели» и
// «заполнить из другого тарифа» меняют не одну модель — при сохранении только текущей
// остальные терялись бы при перезагрузке. Одним upsert'ом всё, что реально изменил владелец.
export async function saveAllKits(tier: Tier, kits: Record<string, ModelKit>, updatedBy: string): Promise<void> {
  const rows = Object.entries(kits).map(([code, kit]) => ({
    tier, model_code: code, kit, updated_by: updatedBy, updated_at: new Date().toISOString(),
  }))
  if (rows.length === 0) return
  const supabase = createServiceClient()
  const { error } = await supabase.from('configurator_model_kits').upsert(rows, { onConflict: 'tier,model_code' })
  if (error) throw new Error(error.message)
}

export async function getKitStore(tier: Tier): Promise<{ library: Library; rates: KitRates; kits: Record<string, ModelKit>; seeded: boolean }> {
  const { library, rates, seeded } = await getLibrary(tier)
  return { library: library ?? emptyLibrary(), rates, kits: await getAllKits(tier, library), seeded }
}
