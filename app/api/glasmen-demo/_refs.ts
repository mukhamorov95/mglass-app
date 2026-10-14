import type { SupabaseClient } from '@supabase/supabase-js'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { loadB2BRates, ratesMissingNote, type B2BRates } from '@/lib/b2b/rates'
import type { FacetPrice } from '@/lib/b2bCalculator'
import type { SurchargeRule } from '@/lib/surcharges'
import type { B2BMaterial } from '@/lib/types'

// Справочники демо GLASMEN — те же таблицы и активные строки, что в app/api/partner/quote,
// но ОБЩИЙ прайс: без индивидуальных цен клиента и без скидки клиента. Вызывать только
// после requireOwner: клиент service-role, RLS не работает.

export type DemoRefs = {
  materials: B2BMaterial[]
  facetPrices: FacetPrice[]
  surchargeRules: SurchargeRule[]
  rates: B2BRates
  warnings: string[]
}

// Справочники меняются редко, а корзина демо шлёт по запросу на строку: держим удачную загрузку
// 60 с в памяти экземпляра (у каждого деплоя свой), параллельные запросы ждут одну загрузку.
// Ошибку не кэшируем — следующий запрос читает заново.
const TTL_MS = 60_000
let cached: { at: number; refs: DemoRefs } | null = null
let inflight: Promise<DemoRefs | { error: string }> | null = null

export async function loadDemoRefs(svc: SupabaseClient): Promise<DemoRefs | { error: string }> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.refs
  if (!inflight) {
    inflight = readDemoRefs(svc)
      .then(r => {
        if (!('error' in r)) cached = { at: Date.now(), refs: r }
        return r
      })
      .finally(() => { inflight = null })
  }
  return inflight
}

async function readDemoRefs(svc: SupabaseClient): Promise<DemoRefs | { error: string }> {
  const [mats, matrix, facets, surcharges, loadedRates] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
    svc.from('facet_prices').select('*').eq('active', true),
    svc.from('b2b_surcharge_rules').select('*').eq('active', true).order('sort_order'),
    loadB2BRates(svc),
  ])
  const failed = [
    mats.error && 'b2b_materials', matrix.error && 'glass_price_matrix',
    facets.error && 'facet_prices', surcharges.error && 'b2b_surcharge_rules',
  ].filter(Boolean)
  if (failed.length) return { error: `Не прочитались справочники: ${failed.join(', ')} — расчёт не выполнен` }

  const materials = prepPricedMaterials((mats.data ?? []) as B2BMaterial[], (matrix.data ?? []) as Array<Record<string, unknown>>)
    .map(m => ({ ...m, thickness: Number(m.thickness) }))
  if (materials.length === 0) return { error: 'В справочнике нет активных материалов с ценой — расчёт не выполнен' }

  const warnings: string[] = []
  const note = ratesMissingNote(loadedRates.missing)
  if (note) warnings.push(note)
  return {
    materials,
    facetPrices: (facets.data ?? []) as FacetPrice[],
    surchargeRules: (surcharges.data ?? []) as SurchargeRule[],
    rates: loadedRates.rates,
    warnings,
  }
}

// Закаляется ли сочетание: зеркало — нет (как lib/glasmen/rules.ts); стекло — да, если в
// b2b_rates есть ставка закалки этой толщины; нет ставки — неизвестно (null), а не «нет».
export function temperableOf(m: Pick<B2BMaterial, 'category' | 'thickness'>, rates: B2BRates): boolean | null {
  if (m.category === 'зеркало') return false
  return rates.temperingPerM2[Number(m.thickness)] != null ? true : null
}
