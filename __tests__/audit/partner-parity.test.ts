import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { computeQuoteItem, computeQuoteTotals } from '@/lib/b2b/computeQuote'
import type { B2BOrderItem, FacetPrice } from '@/lib/b2bCalculator'
import type { SurchargeRule } from '@/lib/surcharges'
import type { B2BMaterial, B2BService } from '@/lib/types'

// АУДИТ ПАРИТЕТА (live). Берём все просчёты, созданные через кабинет (source=partner),
// пересчитываем НАШИМ движком computeQuoteItem (тот же, что у менеджера) и сверяем с
// сохранённой ценой. Классификация расхождений:
//   • exact  — сходится (движок воспроизвёл цену);
//   • drift  — разошлось из-за смены цены материала с момента просчёта (НЕ баг кода);
//   • bug    — цена материала та же, но результат другой → расхождение движка (быть не должно).
// Требование: bug === 0.

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const i = line.indexOf('=')
      if (i < 0 || line.trim().startsWith('#')) continue
      env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* нет файла — тест самопропустится */ }
  return env
}

describe('Аудит паритета: цена клиента == движок', () => {
  it('партнёрские просчёты воспроизводятся движком (0 расхождений кода)', async () => {
    const env = loadEnv()
    const url = env.NEXT_PUBLIC_SUPABASE_URL
    const key = env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) { console.log('⚠ нет ключей Supabase — аудит пропущен'); return }

    const svc = createClient(url, key)
    const [{ data: mats }, { data: matrix }, { data: facets }, { data: surch }, { data: services }] = await Promise.all([
      svc.from('b2b_materials').select('*').eq('active', true),
      svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
      svc.from('facet_prices').select('*').eq('active', true),
      svc.from('b2b_surcharge_rules').select('*').eq('active', true).order('sort_order'),
      svc.from('b2b_services').select('*').eq('active', true),
    ])
    const priced = prepPricedMaterials((mats ?? []) as B2BMaterial[], (matrix ?? []) as Array<Record<string, unknown>>)
    const byId = new Map(priced.map(m => [m.id, m]))
    const facetPrices = (facets ?? []) as FacetPrice[]
    const surchargeRules = (surch ?? []) as SurchargeRule[]
    const triplexSvc = ((services ?? []) as B2BService[]).find(s => s.type === 'per_m2' && /триплекс/i.test(s.name))
    const triplexPrice = triplexSvc ? { salePerM2: Number(triplexSvc.value) || 0, costPerM2: Number(triplexSvc.cost_price) || 0 } : null

    const { data: orders } = await svc.from('b2b_orders')
      .select('id,items,discount_percent,total_after_discount')
      .eq('source', 'partner').limit(1000)

    let exact = 0, drift = 0, bug = 0, empty = 0
    const bugs: Array<{ id: number; stored: number; recomputed: number; delta: number }> = []

    for (const o of (orders ?? []) as Array<{ id: number; items: unknown; discount_percent: number; total_after_discount: number | null }>) {
      const items = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : []
      if (!items.length) { empty++; continue }

      const recomputed: B2BOrderItem[] = []
      let orderDrift = false, orderBug = false
      for (const it of items) {
        const mat = byId.get(Number(it.materialId))
        if (!mat) { orderDrift = true; continue }          // материал удалён/переименован — не баг движка
        const tg = it.hasTriplex
          ? Array.isArray(it.triplexGlasses)
            ? (it.triplexGlasses as Record<string, unknown>[]).map(g => byId.get(Number(g.materialId)) ?? mat)
            : []
          : []
        const calc = computeQuoteItem({
          material: mat, width: Number(it.width), height: Number(it.height), quantity: Number(it.quantity),
          hasTempering: !!it.hasTempering, hasFacet: !!it.hasFacet, facetTypeMm: it.facetTypeMm != null ? Number(it.facetTypeMm) : null,
          hasHoles: !!it.hasHoles, shape: it.shape === 'curved' ? 'curved' : 'rect',
          hasTriplex: !!it.hasTriplex, triplexLayers: Number(it.triplexLayers) === 3 ? 3 : 2, triplexPrice, triplexExtraGlasses: tg,
          applyMinPrice: it.applyMinPrice !== false,
        }, { facetPrices, surchargeRules })
        recomputed.push({ ...calc, localId: 'x' })

        const storedSale = Number(it.saleIncVat) || 0
        if (Math.abs(calc.saleIncVat - storedSale) > 2) {
          const storedPpm = Number(it.pricePerM2) || 0
          if (Math.abs(calc.pricePerM2 - storedPpm) > 1) orderDrift = true   // цена материала изменилась
          else orderBug = true                                               // та же цена, другой результат
        }
      }

      const totals = computeQuoteTotals(recomputed, Number(o.discount_percent) || 0)
      const stored = Number(o.total_after_discount) || 0
      const delta = Math.abs(totals.totalAfterDiscount - stored)

      if (orderBug) { bug++; bugs.push({ id: o.id, stored, recomputed: totals.totalAfterDiscount, delta }) }
      else if (orderDrift || delta > 2) drift++
      else exact++
    }

    const n = (orders ?? []).length
    const report = [
      '══════ АУДИТ ПАРИТЕТА (source=partner) ══════',
      `Всего просчётов: ${n}   (пустых: ${empty})`,
      `точное совпадение цены:            ${exact}`,
      `разошлось из-за смены цен (не баг): ${drift}`,
      `РАСХОЖДЕНИЕ ДВИЖКА (баг):           ${bug}`,
      bugs.length ? 'Первые баги: ' + JSON.stringify(bugs.slice(0, 20)) : '',
    ].join('\n')
    console.log('\n' + report + '\n')
    try { writeFileSync('/private/tmp/claude-501/-Users-mukhamorov01-Desktop-----------mglass-app/c7f9c46e-8530-44b4-8189-28e6274fca44/scratchpad/parity-audit.txt', report) } catch { /* ignore */ }

    expect(bug).toBe(0)
  }, 90000)
})
