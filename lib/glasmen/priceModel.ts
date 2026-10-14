// Модели цены B2B «как у SendCutSend» для демо GLASMEN (/glasmen-demo, только владелец).
// Чистый модуль: без БД, без себестоимости и маржи, без ставок труда. Вход — цена строки
// по действующему движку (computeQuoteItem с applyMinPrice:false) и пол позиции
// resolveMinLinePrice; выход — цена строки и за штуку по каждой модели с разбивкой.
// Модели и калибровка — docs/b2b-site/PRICE_OUR_MODELS.md (раздел 3), механизм
// SendCutSend для сравнения — docs/b2b-site/PRICE_SCS_FORMULA.md.
// Цены прайса — за м² с НДС 22 %; скидка клиента — последней, как в effectiveItemTotal.

import type { B2BOrderItem } from '@/lib/b2bCalculator'
import { PRICE_MODEL_IDS, PARAM_LIMITS, normalizeLadder, ladderPct, applyOrderMinimum, type PriceModelId, type LadderTier, type PriceModelParams } from './priceParams'

export { PRICE_MODEL_IDS, PARAM_LIMITS, normalizeLadder, ladderPct, applyOrderMinimum }
export type { PriceModelId, LadderTier, PriceModelParams }

export type PricePreset = { title: string; description: string; params: PriceModelParams; source: string }

const DRAFT = 'Черновик — ждёт решения владельца (решение 4 маршрута «100 млн»).'
const WINDOW = 'Калибровка: 563 заказа 01.07–14.10.2026 (13,63 млн ₽), выручка нейтральна.'
const DOC = 'docs/b2b-site/PRICE_OUR_MODELS.md'

export const B_LADDER: LadderTier[] = [
  { fromQty: 1, pct: 0 }, { fromQty: 2, pct: 5 }, { fromQty: 5, pct: 10 },
  { fromQty: 10, pct: 15 }, { fromQty: 25, pct: 20 }, { fromQty: 50, pct: 25 },
]

const BASE: PriceModelParams = { S: 0, k: 1, M: 0, ladder: [], floorPerLine: false, ladderAppliesToTempering: true }

export const PRESETS: Record<PriceModelId, PricePreset> = {
  current: {
    title: 'Сейчас',
    description: 'Действующий движок: прайс за м² × площадь × шт. + надбавки; минимальная цена позиции за штуку (пол × шт.); скидка последней. Цена за штуку от количества не зависит. Не черновик — так считается сегодня.',
    params: { ...BASE },
    source: `lib/b2b/computeQuote.ts → lib/b2bCalculator.ts calcItem, effectiveItemTotal; ${DOC} §1`,
  },
  aLine: {
    title: 'A — наладка на строку',
    description: `Прайс × 0,9001 + наладка 1 000 ₽ на строку, без пола; скидка последней. Первая деталь дорогая, каждая следующая дешевле — как у SendCutSend. ${DRAFT} ${WINDOW}`,
    params: { ...BASE, S: 1000, k: 0.9001 },
    source: `${DOC} §3.2 (A-line, S = 1 000), sql_10_model_A.sql`,
  },
  aGroup: {
    title: 'A — наладка на материал заказа',
    description: `Прайс × 0,9781 + наладка 1 000 ₽ один раз на «заказ × материал», без пола; скидка последней. Наладка делится между строками одного стекла. ${DRAFT} ${WINDOW}`,
    params: { ...BASE, S: 1000, k: 0.9781 },
    source: `${DOC} §3.2 (A-group, S = 1 000), sql_10_model_A.sql`,
  },
  ladderB: {
    title: 'B — лесенка за серию',
    description: `Прайс × 1,0315, скидка за серию одинаковых деталей 0/5/10/15/20/25 % от 1/2/5/10/25/50 шт., минимальная цена позиции один раз на строку, минимум заказа 3 000 ₽. Мелочь дорогая, серия дешёвая. ${DRAFT} ${WINDOW}`,
    params: { ...BASE, k: 1.0315, M: 3000, ladder: B_LADDER, floorPerLine: true },
    source: `${DOC} §3.3 (M = 3 000), sql_20_model_B.sql`,
  },
  minC: {
    title: 'C — только минимум заказа',
    description: `Действующий прайс и пол без изменений + минимальная сумма заказа 5 000 ₽. ${DRAFT} Не нейтральна — это доплата: по 907 заказам за 6 мес +142,6 тыс. ₽ (+0,66 %); окно калибровки остальных моделей — 563 заказа 01.07–14.10.2026.`,
    params: { ...BASE, M: 5000 },
    source: `${DOC} §3.4 (M = 5 000 на заказ), sql_30_model_C.sql`,
  },
}

// Какие параметры читает модель — ровно эти ручки имеет смысл показывать в демо.
export const PARAMS_USED: Record<PriceModelId, (keyof PriceModelParams)[]> = {
  current: [],
  aLine: ['S', 'k', 'M'],
  aGroup: ['S', 'k', 'M'],
  ladderB: ['k', 'M', 'ladder', 'floorPerLine', 'ladderAppliesToTempering'],
  minC: ['M'],
}


const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

// Параметры из внешнего ввода (ползунки демо): только известные ключи, числа зажаты в
// разумные пределы, всякое отклонение — вслух в warnings. «Сейчас» не настраивается.
export function sanitizeParams(model: PriceModelId, raw: unknown): { params: PriceModelParams; warnings: string[] } {
  const base = PRESETS[model].params
  const params: PriceModelParams = { ...base, ladder: base.ladder.map(t => ({ ...t })) }
  const warnings: string[] = []
  if (raw == null) return { params, warnings }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`${model}: параметры не объект — взяты по умолчанию`)
    return { params, warnings }
  }
  const r = raw as Record<string, unknown>
  const used = new Set<string>(PARAMS_USED[model])
  for (const key of Object.keys(r)) {
    if (!used.has(key)) warnings.push(`${model}: параметр «${key}» модель не читает — пропущен`)
  }
  const num = (key: 'S' | 'k' | 'M') => {
    if (!used.has(key) || r[key] === undefined) return
    const v = Number(r[key])
    if (!Number.isFinite(v)) { warnings.push(`${model}: ${key} не число — оставлено ${params[key]}`); return }
    const lim = PARAM_LIMITS[key]
    const c = clamp(v, lim.min, lim.max)
    if (c !== v) warnings.push(`${model}: ${key} = ${v} вне ${lim.min}…${lim.max} — взято ${c}`)
    params[key] = c
  }
  num('S'); num('k'); num('M')
  for (const key of ['floorPerLine', 'ladderAppliesToTempering'] as const) {
    if (!used.has(key) || r[key] === undefined) continue
    if (typeof r[key] === 'boolean') params[key] = r[key] as boolean
    else warnings.push(`${model}: ${key} не true/false — оставлено ${params[key]}`)
  }
  if (used.has('ladder') && r.ladder !== undefined) {
    if (!Array.isArray(r.ladder)) warnings.push(`${model}: ladder не массив — оставлена лесенка по умолчанию`)
    else {
      const tiers: LadderTier[] = []
      for (const t of r.ladder.slice(0, PARAM_LIMITS.ladderTiers)) {
        const fq = Math.round(Number((t as LadderTier)?.fromQty))
        const pct = Number((t as LadderTier)?.pct)
        if (!Number.isFinite(fq) || !Number.isFinite(pct)) { warnings.push(`${model}: ступень лесенки без чисел — пропущена`); continue }
        tiers.push({ fromQty: clamp(fq, PARAM_LIMITS.fromQty.min, PARAM_LIMITS.fromQty.max), pct: clamp(pct, PARAM_LIMITS.pct.min, PARAM_LIMITS.pct.max) })
      }
      if (r.ladder.length > PARAM_LIMITS.ladderTiers) warnings.push(`${model}: ступеней больше ${PARAM_LIMITS.ladderTiers} — лишние отброшены`)
      params.ladder = normalizeLadder(tiers)
    }
  }
  if (model === 'ladderB' && !params.ladderAppliesToTempering) {
    warnings.push('ladderB: «лесенка без закалки» требует продажной доли закалки в цене, а прайс за м² её не выделяет — без неё лесенка применена ко всей цене строки')
  }
  return { params, warnings }
}


export type PriceLadderInput = {
  v1: number                         // цена строки за 1 шт. до пола и скидки (computeQuoteItem, applyMinPrice:false)
  floorPerPiece: number              // fp — resolveMinLinePrice(...).minPricePerPiece, 0 если пола нет
  discountPct: number                // скидка клиента, %
  quantities: number[]
  groupLines?: number                // aGroup: сколько строк делят наладку группы; по умолчанию 1
  // v(q) от движка для каждого q. Движок округляет площадь строки (r4) и цену строки от
  // площади × q, поэтому v(q) может отличаться от v1 × q на рубль; без карты берётся v1 × q.
  lineValues?: Record<number, number>
  temperingPart?: number             // ₽ за 1 шт. внутри v1, которые лесенка не трогает (ladderAppliesToTempering:false)
  asWholeOrder?: boolean             // деталь — весь заказ: применить минимум заказа M к строке
  groupIndex?: number                // aGroup: номер строки в группе 0…groupLines−1 — кому достаётся рубль остатка наладки
  // Разбивка v(q) движком: стекло по прайсу, каждая надбавка, фацет (lineComponents → itemComponents).
  // Σ amount обязана равняться v(q); иначе разбивка не используется и строка «По прайсу» идёт одной суммой.
  lineComponents?: Record<number, BreakdownLine[]>
}

export type BreakdownLine = { label: string; amount: number }

// Метод наибольшего остатка: целые рубли, в сумме ровно target, каждая доля ≈ target × w / Σw.
// Ничья по остатку — первой по порядку строке, поэтому доли одной группы стабильны между запросами.
export function allocate(target: number, weights: number[]): number[] {
  const n = weights.length
  if (!n) return []
  const W = weights.reduce((a, w) => a + w, 0)
  const raw = W > 0 ? weights.map(w => (target * w) / W) : weights.map((_, i) => (i === 0 ? target : 0))
  const out = raw.map(Math.floor)
  let left = target - out.reduce((a, x) => a + x, 0)
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i)
  for (let j = 0; left > 0; j = (j + 1) % n, left--) out[order[j].i]++
  return out
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU')
const pctLabel = (p: number) => `${String(Math.round(p * 100) / 100).replace('.', ',')} %`
const fmtNum = (n: number, digits: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: digits })

// Строки цены позиции из ответа движка (computeQuoteItem с applyMinPrice:false): стекло по прайсу,
// каждая надбавка и услуга своей суммой, фацет, триплекс. Стекло выводится вычитанием из saleIncVat —
// движок отдаёт только его, — поэтому Σ = saleIncVat ровно.
export function itemComponents(it: Pick<B2BOrderItem, 'saleIncVat' | 'servicesCost' | 'saleFacet' | 'saleTriplex' | 'services' | 'pricePerM2' | 'totalAreaNet' | 'perimeterM' | 'quantity' | 'facetTypeMm'>): BreakdownLine[] {
  const triplex = it.saleTriplex ?? 0
  const glass = it.saleIncVat - it.servicesCost - it.saleFacet - triplex
  const out: BreakdownLine[] = [{ label: `Стекло по прайсу: ${fmt(it.pricePerM2)} ₽/м² × ${fmtNum(it.totalAreaNet, 4)} м²`, amount: glass }]
  for (const s of it.services) {
    if (!s.cost) continue
    out.push({ label: s.type === 'percent' ? `${s.name} (+${fmtNum(s.value, 2)} % к стеклу)` : s.name, amount: s.cost })
  }
  if (it.saleFacet) out.push({ label: `Фацет ${it.facetTypeMm ?? ''} мм: ${fmtNum(it.perimeterM * it.quantity, 3)} п. м периметра`, amount: it.saleFacet })
  if (triplex) out.push({ label: 'Триплекс', amount: triplex })
  return out
}

export type PriceLadderRow = {
  qty: number
  lineTotal: number                  // ₽ с НДС, после скидки (и минимума заказа, если asWholeOrder)
  perPiece: number                   // round(lineTotal / qty)
  floorApplied: boolean
  minOrderApplied: boolean
  breakdown: BreakdownLine[]         // Σ amount = lineTotal ровно
}


export function priceLadder(input: PriceLadderInput, model: PriceModelId, params?: Partial<PriceModelParams>): PriceLadderRow[] {
  const preset = PRESETS[model].params
  const p: PriceModelParams = model === 'current' ? preset : { ...preset, ...(params ?? {}) }
  const d = (Number(input.discountPct) || 0) / 100
  const after = (x: number) => Math.round(x * (1 - d))
  const fp = Math.max(0, Number(input.floorPerPiece) || 0)
  const n = Math.max(1, Math.round(input.groupLines ?? 1))
  const gi = Math.min(n - 1, Math.max(0, Math.round(input.groupIndex ?? 0)))
  const kLabel = (k: number) => (k === 1 ? '' : ` × ${String(k).replace('.', ',')}`)

  return input.quantities.map(qRaw => {
    const q = Math.round(qRaw)
    if (!(q >= 1)) throw new Error(`Количество должно быть ≥ 1, получено ${qRaw}`)
    const v = input.lineValues?.[q] ?? Math.round(input.v1 * q)
    const comps = input.lineComponents?.[q]
    const compsOk = !!comps?.length && comps.reduce((a, c) => a + c.amount, 0) === v
    // Цена по прайсу строками (стекло, надбавки, фацет); у A/B каждая × k, сумма = round(k·v) ровно.
    const priceLines = (k: number | null): BreakdownLine[] => {
      if (k === null) return compsOk ? comps!.map(c => ({ ...c })) : [{ label: 'По прайсу: ₽/м² × площадь × шт. + надбавки', amount: v }]
      const target = Math.round(k * v)
      if (!compsOk) return [{ label: `По прайсу${kLabel(k) || ' × 1'}`, amount: target }]
      const parts = allocate(target, comps!.map(c => c.amount))
      return comps!.map((c, i) => ({ label: `${c.label}${kLabel(k)}`, amount: parts[i] }))
    }
    const lines: BreakdownLine[] = []
    let floorApplied = false
    let lineTotal: number

    if (model === 'current' || model === 'minC') {
      const floorLine = Math.round(fp * q)
      lines.push(...priceLines(null))
      let pre = v
      if (fp > 0 && v < floorLine) {
        floorApplied = true
        lines.push({ label: `Доплата до минимальной цены позиции (${fmt(fp)} ₽ × ${q} шт.)`, amount: floorLine - v })
        pre = floorLine
      }
      lineTotal = after(pre)
    } else if (model === 'aLine' || model === 'aGroup') {
      const kv = p.k * v
      // aGroup: наладка группы делится между строками методом наибольшего остатка — до и после
      // скидки, — поэтому строки группы в сумме дают ровно round(S) и round(S·(1−d)).
      const share = (T: number) => (model === 'aLine' ? T : allocate(T, Array(n).fill(1))[gi])
      const setupPre = share(Math.round(p.S))
      const setupAfter = share(Math.round(p.S * (1 - d)))
      lines.push(...priceLines(p.k))
      if (setupPre > 0) lines.push({
        label: model === 'aLine' ? 'Наладка на строку' : n > 1 ? `Наладка на материал заказа (доля ${gi + 1} из ${n})` : 'Наладка на материал заказа',
        amount: setupPre,
      })
      lineTotal = after(kv) + setupAfter
    } else {
      const L = ladderPct(q, p.ladder) / 100
      const tp = !p.ladderAppliesToTempering && input.temperingPart ? Math.min(Math.max(0, input.temperingPart) * q, v) : 0
      const kv = p.k * v
      const base = p.k * (v - tp) * (1 - L) + p.k * tp
      const floorAmt = p.floorPerLine ? fp : fp * q
      lines.push(...priceLines(p.k))
      if (L > 0) lines.push({ label: `Скидка за серию ${pctLabel(L * 100)} (${q} шт.)${tp > 0 ? ', без закалки' : ''}`, amount: Math.round(base) - Math.round(kv) })
      let pre = base
      if (fp > 0 && floorAmt > base) {
        floorApplied = true
        lines.push({
          label: p.floorPerLine ? `Доплата до минимальной цены строки (${fmt(fp)} ₽ один раз)` : `Доплата до минимальной цены позиции (${fmt(fp)} ₽ × ${q} шт.)`,
          amount: Math.round(floorAmt) - Math.round(base),
        })
        pre = floorAmt
      }
      lineTotal = after(pre)
    }

    const preSum = lines.reduce((s, l) => s + l.amount, 0)
    if (lineTotal !== preSum) lines.push({ label: d > 0 ? `Скидка ${pctLabel(d * 100)}` : 'Округление', amount: lineTotal - preSum })

    let minOrderApplied = false
    if (input.asWholeOrder && model !== 'current') {
      const m = applyOrderMinimum(lineTotal, p)
      if (m.minOrderApplied) {
        minOrderApplied = true
        lines.push({ label: `Доплата до минимальной суммы заказа (${fmt(p.M)} ₽)`, amount: m.topUp })
        lineTotal = m.total
      }
    }
    return { qty: q, lineTotal, perPiece: Math.round(lineTotal / q), floorApplied, minOrderApplied, breakdown: lines }
  })
}
