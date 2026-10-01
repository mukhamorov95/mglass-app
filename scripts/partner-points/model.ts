// Запуск: npx tsx --tsconfig tsconfig.json scripts/partner-points/model.ts && python3 scripts/partner-points/doc.py
// Результат — outputs/B2B-точки-экономика-ВНУТРЕННЕЕ-*.html (себестоимость — партнёру не показывать).
// Модель точки B2B на стройрынке: позиции считает движок цены (computeQuoteItem + calcTotals) на
// справочниках прода; рост заказов, рейсы и розница M-Glass — допущения, подписаны в листе.
import { readFileSync, writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { computeQuoteItem } from '@/lib/b2b/computeQuote'
import { loadB2BRates } from '@/lib/b2b/rates'
import { calcTotals, type FacetPrice } from '@/lib/b2bCalculator'
import { retailLine, recommendedMarkup } from '@/lib/partner/counter'
import type { SurchargeRule } from '@/lib/surcharges'
import type { B2BMaterial } from '@/lib/types'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// ── Допущения (меняются здесь) ──
const DISC = 10                      // скидка партнёру, решено 01.10
const SMALL_ORDER = { below: 3000, fee: 500 }   // доплата за мелкий заказ — рекомендация, ждёт «да»
const TRIP = { yauza: 1500, melnitsa: 4000 }   // ❓ рейс: Яуза в Мытищах рядом с цехом, Мельница — МКАД 41 км
const ONE_TIME = { samples: 22100, banner: 8000 }   // образцы M2 + зеркала (расчёт №134); баннер — ❓ допущение
const B2C = { check: 117000, contribution: 0.21, partnerReward: 0.05 }  // душевая: чек 114–120 тыс (факт), маржа 40 % минус накладные 19 % = 21 %
const ORDERS = {   // заказов точки в месяц, 12 месяцев
  'осторожный': [3, 5, 7, 9, 10, 12, 13, 14, 15, 16, 17, 18],
  'базовый':    [6, 10, 15, 20, 25, 30, 34, 38, 42, 45, 48, 50],
  'сильный':    [10, 18, 28, 38, 48, 58, 66, 74, 80, 86, 92, 100],
} as const
const SHOWERS = {  // душевых под ключ M-Glass в месяц с этой точки (покупатель увидел образец)
  'осторожный': [0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  'базовый':    [0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1],
  'сильный':    [0, 1, 1, 1, 1, 1, 2, 1, 2, 2, 2, 2],
} as const
// Что приносят покупатели рынка — доли по числу заказов (допущение, проверить по первым 30 заказам)
const MIX = [
  { key: 'mirror', label: 'Зеркало 600×800', id: 60, w: 600, h: 800, t: false, f: false, holes: false, share: 0.40 },
  { key: 'facet', label: 'Зеркало 500×1600 с фацетом', id: 60, w: 500, h: 1600, t: false, f: true, holes: false, share: 0.15 },
  { key: 'apron', label: 'Фартук 600×2000, 6 мм, закалка', id: 52, w: 600, h: 2000, t: true, f: false, holes: false, share: 0.15 },
  { key: 'shower', label: 'Стекло для душа 900×2000, 8 мм', id: 4, w: 900, h: 2000, t: true, f: false, holes: true, share: 0.15 },
  { key: 'shelf', label: 'Полка 250×600, 8 мм, закалка', id: 4, w: 250, h: 600, t: true, f: false, holes: false, share: 0.15 },
]

const trips = (orders: number) => orders === 0 ? 0 : Math.min(9, Math.max(4, Math.ceil(orders / 4)))   // от раза в неделю до двух

async function main() {
  const [{ data: mats }, { data: matrix }, { data: facets }, { data: surcharges }, loaded] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
    svc.from('facet_prices').select('*').eq('active', true),
    svc.from('b2b_surcharge_rules').select('*').eq('active', true).order('sort_order'),
    loadB2BRates(svc),
  ])
  const priced = prepPricedMaterials((mats ?? []) as B2BMaterial[], (matrix ?? []) as Array<Record<string, unknown>>)
  const byId = new Map(priced.map(m => [m.id, m]))
  const pos = MIX.map(e => {
    const it = computeQuoteItem({ material: byId.get(e.id)!, width: e.w, height: e.h, quantity: 1, hasTempering: e.t, hasFacet: e.f, facetTypeMm: e.f ? 10 : null, hasHoles: e.holes, shape: 'rect', applyMinPrice: true },
      { facetPrices: (facets ?? []) as FacetPrice[], surchargeRules: (surcharges ?? []) as SurchargeRule[], rates: loaded.rates })
    const t = calcTotals([{ ...it, localId: 'x' }], DISC)
    const pays = t.totalAfterDiscount
    const small = pays < SMALL_ORDER.below
    const feeKeep = small ? Math.round(SMALL_ORDER.fee / 1.22) : 0      // доплата без НДС
    return { ...e, list: calcTotals([{ ...it, localId: 'x' }], 0).totalAfterDiscount, pays, keep: t.profit, saleEx: t.totalSaleExVatAfterDiscount,
      retail: retailLine(pays, recommendedMarkup(DISC)), small, feeKeep }
  })
  const avg = (f: (p: typeof pos[number]) => number) => pos.reduce((s, p) => s + f(p) * p.share, 0)
  const order = { pays: avg(p => p.pays), keep: avg(p => p.keep), fee: avg(p => p.feeKeep), retail: avg(p => p.retail), saleEx: avg(p => p.saleEx) }
  const showerKeep = B2C.check * (B2C.contribution - B2C.partnerReward)

  type Row = { m: number; orders: number; buy: number; keepB2B: number; fee: number; showers: number; keepB2C: number; trips: number; tripCost: number; oneTime: number; net: number; cum: number }
  function run(name: keyof typeof ORDERS, tripCost: number, withFee: boolean, withShowers: boolean): Row[] {
    let cum = 0
    return ORDERS[name].map((o, i) => {
      const sh = withShowers ? SHOWERS[name][i] : 0
      const keepB2B = o * order.keep, fee = withFee ? o * order.fee : 0, keepB2C = sh * showerKeep
      const tr = trips(o), tc = tr * tripCost, one = i === 0 ? ONE_TIME.samples + ONE_TIME.banner : 0
      const net = keepB2B + fee + keepB2C - tc - one
      cum += net
      return { m: i + 1, orders: o, buy: o * order.pays, keepB2B, fee, showers: sh, keepB2C, trips: tr, tripCost: tc, oneTime: one, net, cum }
    })
  }
  const payback = (rows: Row[]) => rows.find(r => r.cum >= 0)?.m ?? null
  const year = (rows: Row[]) => rows.reduce((s, r) => s + r.net, 0)
  const out: Record<string, unknown> = { pos, order, showerKeep }
  for (const n of Object.keys(ORDERS) as (keyof typeof ORDERS)[]) {
    for (const [mk, tc] of Object.entries(TRIP)) {
      const full = run(n, tc, true, true)
      out[`${n}|${mk}`] = { payback: payback(full), year: Math.round(year(full)), m12: Math.round(full[11].net), buyYear: Math.round(full.reduce((s, r) => s + r.buy, 0)),
        noFee: Math.round(year(run(n, tc, false, true))), noShowers: Math.round(year(run(n, tc, true, false))), bare: Math.round(year(run(n, tc, false, false))), rows: full }
    }
  }
  writeFileSync('outputs/points-model.json', JSON.stringify(out, null, 1))
  for (const k of Object.keys(out).filter(k => k.includes('|'))) {
    const v = out[k] as { payback: number | null; year: number; m12: number; buyYear: number; noFee: number; noShowers: number; bare: number }
    console.log(k, JSON.stringify({ payback: v.payback, year: v.year, m12: v.m12, buyYear: v.buyYear, noFee: v.noFee, noShowers: v.noShowers, bare: v.bare }))
  }
  console.log('order', JSON.stringify(order), 'showerKeep', showerKeep)
  console.log(JSON.stringify(pos.map(p => ({ k: p.key, pays: p.pays, keep: p.keep, small: p.small, retail: p.retail }))))
}
main()
