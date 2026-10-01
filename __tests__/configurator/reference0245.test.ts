import { describe, it, expect } from 'vitest'
import { computeKitQuantities, computeKitPrice, type Library, type LibraryItem, type ModelKit, type KitRates, type RoleId } from '@/lib/configurator/kit'
import { planOrderCutting } from '@/lib/configurator/orderPlan'
import { buildWithVariant } from '@/lib/configurator/quoteContract'
import { getModel } from '@/lib/configurator/arrangement'
import { rowFinish } from '@/lib/supplier/colorCode'
import av24 from '../fixtures/configurator/av24-0245-rows.json'

// Эталон — заказ 0245-0, высота 2 200, вся фурнитура чёрная, АВ24 −25 %.
// Ручной лист владельца 01.10.2026 (розница с сайта × 0,75):
//   душевая 1 (М4, ниша 1 450, дверь 650) — 16 380 ₽;
//   душевая 2 (М7, угол 1 469 × 916, дверь 650) — 15 349 ₽;
//   обе одной закупкой — 30 986 ₽ (общий хлыст профиля под низ и одна полоса нижнего уплотнителя).
// Маршрут: docs/configurator/SHOWROOM_COST_ROUTE.md, этап Э1. Разрывы, которые закроют
// следующие этапы, записаны как it.fails с номером этапа: когда этап сделан, тест краснеет
// и превращается в обычный it.

type Row = { article: string; color: string | null; name: string; retail: number; discount: number; cost: number }
const ROWS = (av24 as { rows: Row[] }).rows

// Две строки на сайте 01.10 разошлись со снимком справочника (19.08) — лист владельца
// считал по сайту. Остальные 18 позиций совпали.
const RETAIL_0110: Record<string, number> = {
  'FDPA-55.22 AL/BL': 880,   // в снимке 850
  'FDC-35 SUS304/BL': 855,   // в снимке 830
}
// Себестоимость = розница × (1 − скидка поставщика), без промежуточного округления:
// лист владельца — сумма розницы × 0,75, округление только у итога.
const costOf = (article: string) => {
  const r = ROWS.find(x => x.article === article)
  if (!r) throw new Error(`нет строки ${article} в фикстуре`)
  return (RETAIL_0110[article] ?? r.retail) * (1 - r.discount / 100)
}

// ── Слой А: движок на правильных входах ──────────────────────────────
// Чёрная цена каждой позиции берётся прямо из строки «…/BL», минуя распознавание цвета:
// так проверяется сам движок (количества, раскрой, сумма), а не справочник.
const black = (article: string) => ({ black: costOf(article) })
const piece = (id: string, role: RoleId, article: string): LibraryItem =>
  ({ id, name: article, role, prices: black(article) })
const bar = (id: string, role: RoleId, stocks: [number, string][]): LibraryItem =>
  ({ id, name: stocks.map(s => s[1]).join(' + '), role, stocks: stocks.map(([len, a]) => ({ len, prices: black(a) })) })

const LIB: Library = { items: [
  piece('hinge', 'hinge', 'FDP-232 BR/BL'),
  piece('handle', 'handle', 'FDR-76 SUS304/BL'),
  piece('wall', 'mount-wall', 'FDC-38 SUS304/BL'),
  piece('holder', 'mount-glass', 'FDC-35 SUS304/BL'),
  piece('corner', 'mount-corner', 'FDC-34 SUS304/BL'),
  piece('end', 'cap-end', 'FDPA-501 SUS304/BL'),
  bar('mag180', 'seal-magnet', [[2200, 'FDPP-503.8 PVC/BL']]),
  bar('mag90', 'seal-magnet', [[2200, 'FDPP-502.8 PVC/BL']]),
  bar('sealA', 'seal-hinge', [[2200, 'FDPP-404.8 PVC/BL']]),
  bar('sealCh', 'seal-bottom', [[2200, 'FDPP-402.8 PVC/BL']]),
  bar('profile', 'profile', [[2200, 'FDPA-55.22 AL/BL'], [3000, 'FDPA-55.3 AL/BL']]),
  bar('tube', 'tube', [[2000, 'FDT-302 SUS304/BL']]),
] }

const slot = (role: RoleId, itemId: string, qty: ModelKit['slots'][number]['entries'][number]['qty'] = { mode: 'role' }) =>
  ({ role, select: 'one' as const, entries: [{ itemId, qty, primary: true }] })
// Комплект, как его собрал владелец для 0245. Погонной заглушки в проёме двери нет:
// низ профиля у владельца идёт только под неподвижными стёклами (решение 3 маршрута),
// а торцевых заглушек — по 4 на душевую.
const common = [
  slot('hinge', 'hinge'), slot('handle', 'handle'), slot('mount-wall', 'wall'), slot('mount-glass', 'holder'),
  slot('seal-hinge', 'sealA'), slot('seal-bottom', 'sealCh'), slot('profile', 'profile'), slot('tube', 'tube'),
  slot('cap-end', 'end', { mode: 'fixed', n: 4 }),
]
const KIT_M4: ModelKit = { slots: [...common, slot('seal-magnet', 'mag180')], excluded: ['cap'] }
const KIT_M7: ModelKit = { slots: [...common, slot('mount-corner', 'corner'), slot('seal-magnet', 'mag90')], excluded: ['cap'] }

const RATES: KitRates = { glassPerM2: {}, installPerSection: 0, deliveryMoscow: 0, liftPerFloor: 0 }
const FIN = { marginPct: 40, taxPct: 12 }

const M4 = { model: getModel('М4'), dims: { width: 1450, height: 2200, doorWidth: 650 } }
const M7 = { model: getModel('М7'), dims: { width: 1469, width2: 916, height: 2200, doorWidth: 650 } }
const qOf = (s: typeof M4) => computeKitQuantities(buildWithVariant(s.model, s.dims, 8), 8, s.model)
const price = (s: typeof M4, kit: ModelKit) => computeKitPrice(qOf(s), LIB, kit, RATES, FIN, { finishId: 'black', withDelivery: false })

// Лист владельца построчно в рознице; ±2 ₽ — округление каждой строки движка до рубля.
const REF_M4 = 21_840 * 0.75   // 16 380
const REF_M7 = 20_465 * 0.75   // 15 348,75
const REF_BOTH = 30_986

describe('Эталон 0245, высота 2 200, чёрный — фурнитура АВ24 −25 %', () => {
  it('М4: количества как в ручном листе', () => {
    const lines = price(M4, KIT_M4).lines
    const qty = Object.fromEntries(lines.map(l => [l.itemId, l.qty]))
    expect(qty).toEqual({
      hinge: 2, handle: 1, wall: 2, holder: 2, sealA: 1, sealCh: 1, profile: 3, tube: 1, end: 4, mag180: 1,
    })
  })

  it('М4: фурнитура = 16 380 ₽ (±2 ₽ округления строк)', () => {
    const p = price(M4, KIT_M4)
    expect(p.missing).toEqual([])
    expect(Math.abs(p.hardwareCost - REF_M4)).toBeLessThanOrEqual(2)
  })

  it('М7: количества как в ручном листе (кроме профиля — см. ниже)', () => {
    const lines = price(M7, KIT_M7).lines
    const qty = Object.fromEntries(lines.filter(l => l.itemId !== 'profile').map(l => [l.itemId, l.qty]))
    expect(qty).toEqual({
      hinge: 2, handle: 1, wall: 1, holder: 1, corner: 1, sealA: 1, sealCh: 1, tube: 1, end: 4, mag90: 1,
    })
  })

  // Профиль М7: движок кладёт низ и под дверь (1 469 вместо 819) и не умеет брать хлысты
  // разной длины в одном плане (2 × 2,2 м + 1 × 3 м). Выходит 3 × 3 м = 2 340 ₽ против
  // 3 × 2,2 м = 1 980 ₽ у владельца. Закрывают Э5 (смешанные хлысты) и Э8 (низ по решению 3).
  it.fails('М7: фурнитура = 15 349 ₽ — ждёт Э5 и Э8', () => {
    const p = price(M7, KIT_M7)
    expect(p.missing).toEqual([])
    expect(Math.abs(p.hardwareCost - REF_M7)).toBeLessThanOrEqual(2)
  })

  // Обе душевые одной закупкой: общий хлыст профиля под низ и одна полоса нижнего
  // уплотнителя на обе двери — минус 743 ₽. Общий раскрой ключуется по позиции и цвету и
  // отдаёт min(общий, поштучный) — Э5.
  it.fails('Обе сразу: 30 986 ₽ — ждёт Э5 и Э8', () => {
    const a = price(M4, KIT_M4)
    const b = price(M7, KIT_M7)
    const cut = planOrderCutting([
      { q: qOf(M4), lib: LIB, kit: KIT_M4, finishId: 'black' },
      { q: qOf(M7), lib: LIB, kit: KIT_M7, finishId: 'black' },
    ])
    expect(Math.abs(a.hardwareCost + b.hardwareCost - cut.saving - REF_BOTH)).toBeLessThanOrEqual(2)
  })
})

// ── Слой Б: справочник → цена цвета ─────────────────────────────────
// Владелец: «движок должен понимать код цвета, чтобы подставлять стоимость этого цвета».
// Строка АВ24 «FDPP-503.8 PVC/BL» несёт цвет кодом после «/»; у части строк поле color —
// тот же код без слова («BL», «TP», «BZ»). С Э2 цвет читается по коду (lib/supplier/colorCode.ts).
describe('Цвет строки АВ24 распознаётся по коду артикула', () => {
  const blackRows = ROWS.filter(r => /\/BL$/.test(r.article))

  it('строк «…/BL» среди ходовых — не меньше 20', () => {
    expect(blackRows.length).toBeGreaterThanOrEqual(20)
  })

  it('каждая «…/BL» — чёрный', () => {
    const axis = (a: string) => (/^FDPP-/.test(a) ? 'consumable' as const : 'hardware' as const)
    const wrong = blackRows.filter(r => rowFinish('av24', r, axis(r.article)) !== 'black').map(r => r.article)
    expect(wrong).toEqual([])
  })
})
