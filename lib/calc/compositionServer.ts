import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { loadB2BRates } from '@/lib/b2b/rates'
import { MGLASS_CLIENT_IDS } from '@/lib/b2bScope'
import type { B2BMaterial } from '@/lib/types'
import type { SupplierRowLike } from '@/lib/supplier/colorCode'
import { defaultArticle, priceComposition, SUPPLIER_RU, type CompositionInput, type Supplier } from '@/lib/calc/composition'

// Загрузка для расчёта по составу (Ч3): стекло B2B со скидкой M GLASS — теми же запросами,
// что buildPrice.ts, и строки АВ24 и Ветро по артикулам состава. Клиент — service role:
// вызывающий проверяет доступ до вызова.

// Стекло экрана → имя материала B2B. Тот же список, что GLASS_TYPES в app/calculator/build/page.tsx.
export const GLASS_B2B_NAME: Record<string, string> = {
  clear: 'Прозрачное М1',
  crystal: 'Осветлённое CrystalVision',
  graphite: 'Тонированное (бронза/графит)',
  matte: 'Сатинированное бесцветное',
  'matte-crystal': 'CrystalVision Matelux',
  bronze: 'Тонированное (бронза/графит)',
}

export type CompositionRequest = CompositionInput & { glassId: string; thickness?: number }

// LIKE по «артикул%», лишнее («FDR-90-DEF», «FDP-2300») отсекает rowsForArticle / vetroRowsFor.
// У Ветро ищем по модели до первого «/»: цвет в артикуле стоит после неё.
async function loadRows(svc: SupabaseClient, supplier: Supplier, articles: string[]): Promise<SupplierRowLike[]> {
  const prefixes = [...new Set(articles.map(a => (supplier === 'vetro' ? a.split('/')[0] : a)))]
  const res = await Promise.all(prefixes.map(a =>
    svc.from('supplier_price_rows').select('article,name,color,retail_price,discount_percent,cost_price')
      .eq('supplier', supplier).eq('active', true).like('article', `${a}%`).limit(200)))
  const err = res.find(r => r.error)?.error
  if (err) throw new Error(`Справочник ${SUPPLIER_RU[supplier]} не прочитан: ${err.message}`)
  return res.flatMap(r => (r.data ?? []) as SupplierRowLike[])
}

export async function loadComposition(svc: SupabaseClient, body: CompositionRequest) {
  const thickness = body.thickness ?? 8
  const glassAsked = GLASS_B2B_NAME[body.glassId] ?? body.glassId
  const articlesOf = (sup: Supplier) => [...new Set(body.hardware.filter(h => (h.supplier ?? 'av24') === sup).map(h =>
    h.article?.trim() || (sup === 'av24' ? defaultArticle(h.role, h.label, h.pieces_mm ?? []) : null)).filter((a): a is string => !!a))]
  const vetroArticles = articlesOf('vetro')

  const [{ data: mats, error: e1 }, { data: matrix, error: e2 }, { data: mg, error: e3 }, rates, av24, vetro] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
    svc.from('b2b_clients').select('id,discount_percent').in('id', [...MGLASS_CLIENT_IDS]).maybeSingle(),
    loadB2BRates(svc),
    loadRows(svc, 'av24', articlesOf('av24')),
    vetroArticles.length ? loadRows(svc, 'vetro', vetroArticles) : Promise.resolve([]),
  ])
  const err = e1 ?? e2 ?? e3
  if (err) throw new Error(`Справочник стекла не прочитан: ${err.message}`)

  const priced = prepPricedMaterials((mats ?? []) as B2BMaterial[], (matrix ?? []) as Array<Record<string, unknown>>)
  const glass = priced.find(m => m.name === glassAsked && Math.round(m.thickness) === thickness && m.category !== 'зеркало') ?? null
  const result = priceComposition(body, { glass, glassAsked: `${glassAsked} ${thickness} мм`, rates: rates.rates, mgDiscount: Number(mg?.discount_percent) || 0, av24, vetro })
  if (rates.missing.length) result.notes.push(`Нет в справочнике ставок: ${rates.missing.join(', ')} — взяты заводские значения`)
  return result
}
