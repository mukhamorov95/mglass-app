import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'
import { getKitStore } from '@/lib/configurator/kitStore'
import { getFinance, FINANCE_FALLBACK, type Finance } from '@/lib/configurator/financeStore'
import type { Library, ModelKit, KitRates } from '@/lib/configurator/kit'
import type { Tier } from '@/lib/configurator/pricing'

// Версия прайса — замороженный снимок всего, что нужно computeKitPrice: библиотека,
// комплекты, ставки и финансы по обоим тарифам. КП считается по версии, а не по живому
// прайсу, поэтому сумма в выданном КП не меняется после подорожания. Снимок автономен.

export type TierSnapshot = { library: Library; rates: KitRates; kits: Record<string, ModelKit> }
export type PriceSnapshot = {
  budget: TierSnapshot
  premium: TierSnapshot
  finance: Record<Tier, Finance>
}
export type PriceVersion = {
  id: number
  label: string
  validDays: number
  publishedBy: string
  publishedAt: string
  snapshot: PriceSnapshot
}
export type PriceVersionMeta = Omit<PriceVersion, 'snapshot'>

export async function currentSnapshot(): Promise<PriceSnapshot> {
  const [budget, premium, finBudget, finPremium] = await Promise.all([
    getKitStore('budget'), getKitStore('premium'), getFinance('budget'), getFinance('premium'),
  ])
  return {
    budget: { library: budget.library, rates: budget.rates, kits: budget.kits },
    premium: { library: premium.library, rates: premium.rates, kits: premium.kits },
    finance: { budget: finBudget, premium: finPremium },
  }
}

export async function publishVersion(label: string, validDays: number, publishedBy: string): Promise<PriceVersionMeta> {
  const snapshot = await currentSnapshot()
  const supa = createServiceClient()
  const { data, error } = await supa.from('configurator_price_versions')
    .insert({ label: label.slice(0, 120), snapshot, valid_days: Math.max(1, Math.round(validDays) || 30), published_by: publishedBy })
    .select('id, label, valid_days, published_by, published_at').single()
  if (error) throw new Error(error.message)
  return { id: data.id, label: data.label, validDays: data.valid_days, publishedBy: data.published_by, publishedAt: data.published_at }
}

export async function listVersions(limit = 30): Promise<PriceVersionMeta[]> {
  try {
    const supa = createServiceClient()
    const { data } = await supa.from('configurator_price_versions')
      .select('id, label, valid_days, published_by, published_at')
      .order('published_at', { ascending: false }).limit(limit)
    return (data ?? []).map(r => ({
      id: r.id, label: r.label, validDays: r.valid_days, publishedBy: r.published_by, publishedAt: r.published_at,
    }))
  } catch { return [] }
}

export async function getVersion(id: number): Promise<PriceVersion | null> {
  try {
    const supa = createServiceClient()
    const { data } = await supa.from('configurator_price_versions')
      .select('id, label, snapshot, valid_days, published_by, published_at').eq('id', id).maybeSingle()
    if (!data) return null
    return {
      id: data.id, label: data.label, validDays: data.valid_days,
      publishedBy: data.published_by, publishedAt: data.published_at, snapshot: data.snapshot as PriceSnapshot,
    }
  } catch { return null }
}

// Данные тарифа для расчёта: из версии — из её снимка, иначе — из живого прайса.
export async function resolveTierData(
  tier: Tier, versionId?: number,
): Promise<{ data: TierSnapshot; finance: Finance; version: PriceVersionMeta | null; validUntil: string | null }> {
  if (versionId) {
    const v = await getVersion(versionId)
    if (v) {
      const data = v.snapshot[tier]
      const finance = v.snapshot.finance?.[tier] ?? FINANCE_FALLBACK
      const validUntil = new Date(new Date(v.publishedAt).getTime() + v.validDays * 86400_000).toISOString()
      return { data, finance, version: { id: v.id, label: v.label, validDays: v.validDays, publishedBy: v.publishedBy, publishedAt: v.publishedAt }, validUntil }
    }
  }
  const [store, finance] = await Promise.all([getKitStore(tier), getFinance(tier)])
  return { data: { library: store.library, rates: store.rates, kits: store.kits }, finance, version: null, validUntil: null }
}
