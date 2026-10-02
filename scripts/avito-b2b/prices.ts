// Запуск: npx tsx --tsconfig tsconfig.json scripts/avito-b2b/prices.ts
// Цены для объявлений GLASMEN на Авито (docs/avito-b2b/LISTINGS.md). Считает движок цены
// (computeQuoteItem) на справочниках прода — тот же, что /calculator/b2b и кабинет партнёра.
// Частнику напрямую — прайс без скидки (решение владельца 01.10), поэтому печатается saleIncVat.
// Только чтение базы. После правки прайса — перезапустить и обновить цены в объявлениях.
import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { computeQuoteItem } from '@/lib/b2b/computeQuote'
import { loadB2BRates } from '@/lib/b2b/rates'
import type { FacetPrice } from '@/lib/b2bCalculator'
import type { SurchargeRule } from '@/lib/surcharges'
import type { B2BMaterial } from '@/lib/types'

// .env.local лежит в корне mglass-app; из worktree (.claude/worktrees/<имя>) ищем вверх.
function findEnv(): string {
  let dir = resolve('.')
  for (;;) {
    const p = join(dir, '.env.local')
    if (existsSync(p)) return p
    const up = dirname(dir)
    if (up === dir) throw new Error('.env.local не найден ни в текущей папке, ни выше')
    dir = up
  }
}
const env = Object.fromEntries(readFileSync(findEnv(), 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

type Ex = { listing: string; label: string; id: number; w: number; h: number; t: boolean; facet?: 10 | 15 | 20; perM2?: boolean }

// id — b2b_materials. Пример «за м²» считается на листе 1000×2000: на 1 м² у закалённой детали
// срабатывает минимальная цена позиции (b2b_rates.min_glass_tempering) и цена за м² искажается.
const EXAMPLES: Ex[] = [
  { listing: '1 По чертежам', label: 'Прозрачное 4 мм', id: 1, w: 1000, h: 2000, t: false, perM2: true },
  { listing: '1 По чертежам', label: 'Прозрачное 8 мм, закалка, 500×700', id: 4, w: 500, h: 700, t: true },
  { listing: '2 Зеркала', label: 'Серебро 4 мм', id: 60, w: 1000, h: 2000, t: false, perM2: true },
  { listing: '2 Зеркала', label: 'Серебро 4 мм, 600×800', id: 60, w: 600, h: 800, t: false },
  { listing: '2 Зеркала', label: 'Серебро 6 мм', id: 61, w: 1000, h: 2000, t: false, perM2: true },
  { listing: '2 Зеркала', label: 'Осветлённое 4 мм', id: 49, w: 1000, h: 2000, t: false, perM2: true },
  { listing: '2 Зеркала', label: 'Бронза / графит 4 мм', id: 16, w: 1000, h: 2000, t: false, perM2: true },
  { listing: '2 Зеркала', label: 'Состаренное (Antique A-1) 4 мм', id: 65, w: 1000, h: 2000, t: false, perM2: true },
  { listing: '3 Стекло с закалкой', label: 'Прозрачное 4 мм', id: 1, w: 1000, h: 2000, t: true, perM2: true },
  { listing: '3 Стекло с закалкой', label: 'Прозрачное 6 мм', id: 3, w: 1000, h: 2000, t: true, perM2: true },
  { listing: '3 Стекло с закалкой', label: 'Прозрачное 8 мм', id: 4, w: 1000, h: 2000, t: true, perM2: true },
  { listing: '3 Стекло с закалкой', label: 'Прозрачное 10 мм', id: 5, w: 1000, h: 2000, t: true, perM2: true },
  { listing: '3 Стекло с закалкой', label: 'Осветлённое 8 мм', id: 53, w: 1000, h: 2000, t: true, perM2: true },
  { listing: '3 Стекло с закалкой', label: 'Матовое Matelux 8 мм', id: 14, w: 1000, h: 2000, t: true, perM2: true },
  { listing: '3 Стекло с закалкой', label: 'Рифлёное Мору 8 мм', id: 66, w: 1000, h: 2000, t: true, perM2: true },
  { listing: '3 Стекло с закалкой', label: 'Деталь 300×300, прозрачное 8 мм', id: 4, w: 300, h: 300, t: true },
  { listing: '4 Фацет', label: 'Зеркало серебро 4 мм 500×1600, фацет 10 мм', id: 60, w: 500, h: 1600, t: false, facet: 10 },
  { listing: '4 Фацет', label: 'Зеркало серебро 4 мм 500×1600, фацет 20 мм', id: 60, w: 500, h: 1600, t: false, facet: 20 },
  { listing: '4 Фацет', label: 'Зеркало серебро 4 мм 800×1000, фацет 15 мм', id: 60, w: 800, h: 1000, t: false, facet: 15 },
  { listing: '5 Фартук', label: 'Осветлённое 6 мм, закалка, 600×2000', id: 52, w: 600, h: 2000, t: true },
  { listing: '5 Фартук', label: 'Прозрачное 6 мм, закалка, 600×2000', id: 3, w: 600, h: 2000, t: true },
  { listing: '6 Стол', label: 'Прозрачное 8 мм, закалка, 800×1200', id: 4, w: 800, h: 1200, t: true },
  { listing: '6 Стол', label: 'Прозрачное 10 мм, закалка, 900×1600', id: 5, w: 900, h: 1600, t: true },
  { listing: '7 Полки', label: 'Прозрачное 6 мм, закалка, 200×500', id: 3, w: 200, h: 500, t: true },
  { listing: '7 Полки', label: 'Прозрачное 8 мм, закалка, 250×600', id: 4, w: 250, h: 600, t: true },
  { listing: '7 Полки', label: 'Прозрачное 8 мм, закалка, 300×800', id: 4, w: 300, h: 800, t: true },
  // Товарные «крючки» второй версии (02.10): позиции, на которых у конкурентов идут сделки.
  { listing: 'Т Стекло с резкой', label: 'Прозрачное 4 мм, 500×700, без закалки', id: 1, w: 500, h: 700, t: false },
  { listing: 'Т Стекло с резкой', label: 'Прозрачное 4 мм, 1300×1600, без закалки', id: 1, w: 1300, h: 1600, t: false },
  { listing: 'Т Зеркало большое', label: 'Серебро 4 мм, 1000×1800', id: 60, w: 1000, h: 1800, t: false },
  { listing: 'Т Зеркало цветное', label: 'Бронза / графит 4 мм, 600×800', id: 16, w: 600, h: 800, t: false },
  { listing: 'Т Матовое', label: 'Матовое Matelux 8 мм, закалка, 500×700', id: 14, w: 500, h: 700, t: true },
  { listing: 'Т Матовое', label: 'Матовое Matelux 8 мм, закалка, 400×1800 (дверь шкафа)', id: 14, w: 400, h: 1800, t: true },
  { listing: 'Т Витрины', label: 'Прозрачное 8 мм, закалка, 400×1000 (полка витрины)', id: 4, w: 400, h: 1000, t: true },
  { listing: 'Т Мебель', label: 'Прозрачное 6 мм, закалка, 400×700 (дверца)', id: 3, w: 400, h: 700, t: true },
]

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} ₽`

async function main() {
  const [{ data: mats }, { data: matrix }, { data: facets }, { data: surcharges }, loaded] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
    svc.from('facet_prices').select('*').eq('active', true),
    svc.from('b2b_surcharge_rules').select('*').eq('active', true).order('sort_order'),
    loadB2BRates(svc),
  ])
  if (loaded.missing.length) throw new Error(`Нет ставок в b2b_rates: ${loaded.missing.join(', ')} — цены неполные`)
  const priced = prepPricedMaterials((mats ?? []) as B2BMaterial[], (matrix ?? []) as Array<Record<string, unknown>>)
  const byId = new Map(priced.map(m => [m.id, m]))
  const ref = { facetPrices: (facets ?? []) as FacetPrice[], surchargeRules: (surcharges ?? []) as SurchargeRule[], rates: loaded.rates }

  console.log(`Цены прайса без скидки, с НДС — движок computeQuoteItem, ${new Date().toLocaleDateString('ru-RU')}\n`)
  console.log('| Объявление | Позиция | Цена |')
  console.log('|---|---|---|')
  for (const e of EXAMPLES) {
    const m = byId.get(e.id)
    if (!m) throw new Error(`Материал ${e.id} (${e.label}) не активен — пример устарел`)
    const it = computeQuoteItem({
      material: m, width: e.w, height: e.h, quantity: 1, hasTempering: e.t,
      hasFacet: !!e.facet, facetTypeMm: e.facet ?? null, shape: 'rect', applyMinPrice: true,
    }, ref)
    const price = e.perM2 ? `${rub(it.saleIncVat / it.totalAreaNet)} за м²` : rub(it.saleIncVat)
    console.log(`| ${e.listing} | ${e.label} | ${price} |`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
