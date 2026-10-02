// 2D Guillotine Bin Packing for glass cutting
// Algorithm: Best Short Side Fit (BSSF) + guillotine split
// Multi-strategy optimization: runs N sort orders, picks the best result.
// Однотипные детали — ещё и блочная раскладка листа (точный перебор гильотинных резов).

export type CuttingPiece = {
  id: string
  width: number            // мм нетто
  height: number           // мм нетто
  label: string
  orderId: number
  orderClientName: string
  materialKey: string
  canRotate: boolean       // false for patterned glass
}

export type PlacedPiece = {
  id: string
  x: number
  y: number
  w: number
  h: number
  rotated: boolean
  label: string
  orderId: number
  orderClientName: string
  colorIndex: number
}

export type Remnant = {
  x: number; y: number; w: number; h: number  // мм
}

export type CuttingSheet = {
  index: number
  pieces: PlacedPiece[]
  usedArea: number         // мм²
  totalArea: number        // мм²
  efficiency: number       // %
  remnants: Remnant[]      // значимые свободные прямоугольники (остатки)
}

export type MaterialCuttingResult = {
  materialKey: string
  materialLabel: string
  category: string
  sheetWidth: number
  sheetHeight: number
  patternDirection: 'none' | 'along_length' | 'along_width'
  sheets: CuttingSheet[]
  totalPieces: number
  sheetsNeeded: number
  totalUsedArea: number
  totalSheetArea: number
  avgEfficiency: number
  strategiesChecked?: number   // how many sort strategies were tried
  unplacedPieces: CuttingPiece[]
  unplacedCount: number
}

export type CuttingSettings = {
  gap_between_pieces: number
  edge_margin: number
  allow_rotation: boolean
  respect_pattern: boolean
  // Остаток листа — кусок не меньше этого (короткая × длинная сторона, мм). Меньше — полоса
  // в отход. Решение владельца 15.09: 400×800 (в такой кусок влезает каждая шестая деталь).
  min_remnant_short?: number
  min_remnant_long?: number
}

// Порог остатка листа, мм. Один на систему: раскрой, калькулятор, экономика заказа и
// стеллаж (lib/production/remnants.ts). Правится в /admin/cutting-settings.
export const REMNANT_MIN_SHORT = 400
export const REMNANT_MIN_LONG = 800

export const DEFAULT_CUTTING_SETTINGS: CuttingSettings = {
  gap_between_pieces: 2,
  edge_margin: 2,
  allow_rotation: true,
  respect_pattern: true,
  min_remnant_short: REMNANT_MIN_SHORT,
  min_remnant_long: REMNANT_MIN_LONG,
}

// ─── Internal types ────────────────────────────────────────────────────────────

type FreeRect = { x: number; y: number; w: number; h: number }
type Placement = { rectIdx: number; placed: PlacedPiece }
type Packed = { sheets: CuttingSheet[]; unplaced: CuttingPiece[] }

// ─── Core BSSF placement ──────────────────────────────────────────────────────

function tryPlace(
  piece: CuttingPiece,
  freeRects: FreeRect[],
  gap: number,
  allowRotate: boolean,
  colorIndex: number,
): Placement | null {
  let bestScore = Infinity
  let bestIdx = -1
  let bestRotated = false

  for (let i = 0; i < freeRects.length; i++) {
    const r = freeRects[i]

    const nw = piece.width + gap
    const nh = piece.height + gap
    if (nw <= r.w && nh <= r.h) {
      const score = Math.min(r.w - nw, r.h - nh)
      if (score < bestScore) { bestScore = score; bestIdx = i; bestRotated = false }
    }

    if (allowRotate && piece.canRotate && piece.width !== piece.height) {
      const rw = piece.height + gap
      const rh = piece.width + gap
      if (rw <= r.w && rh <= r.h) {
        const score = Math.min(r.w - rw, r.h - rh)
        if (score < bestScore) { bestScore = score; bestIdx = i; bestRotated = true }
      }
    }
  }

  if (bestIdx === -1) return null

  const r = freeRects[bestIdx]
  const actualW = bestRotated ? piece.height : piece.width
  const actualH = bestRotated ? piece.width : piece.height

  return {
    rectIdx: bestIdx,
    placed: { id: piece.id, x: r.x, y: r.y, w: actualW, h: actualH, rotated: bestRotated, label: piece.label, orderId: piece.orderId, orderClientName: piece.orderClientName, colorIndex },
  }
}

function applyPlacement(placement: Placement, freeRects: FreeRect[], gap: number): void {
  const { rectIdx, placed } = placement
  const r = freeRects[rectIdx]
  const usedW = placed.w + gap
  const usedH = placed.h + gap
  const rightW = r.w - usedW
  const topH = r.h - usedH

  freeRects.splice(rectIdx, 1)

  if (rightW >= topH) {
    if (rightW > gap) freeRects.push({ x: r.x + usedW, y: r.y, w: rightW, h: r.h })
    if (topH > gap) freeRects.push({ x: r.x, y: r.y + usedH, w: usedW, h: topH })
  } else {
    if (topH > gap) freeRects.push({ x: r.x, y: r.y + usedH, w: r.w, h: topH })
    if (rightW > gap) freeRects.push({ x: r.x + usedW, y: r.y, w: rightW, h: usedH })
  }
}

// ─── Single-pass packing (pre-sorted input) ────────────────────────────────────

// Minimum free-rect size for strip packing (mm) — не путать с порогом остатка
const MIN_REMNANT_MM = 200

// Один порог остатка на всю систему: кусок от 400×800 мм ложится на стеллаж и идёт
// в следующие заказы, меньше — полоса в отход (решение владельца 15.09.2026).
export function isRemnant(w: number, h: number, settings?: Pick<CuttingSettings, 'min_remnant_short' | 'min_remnant_long'>): boolean {
  const short = settings?.min_remnant_short ?? REMNANT_MIN_SHORT
  const long = settings?.min_remnant_long ?? REMNANT_MIN_LONG
  return Math.min(w, h) >= short && Math.max(w, h) >= long
}

function significantRemnants(freeRects: FreeRect[], e: number, settings?: CuttingSettings): Remnant[] {
  return freeRects
    .filter(r => isRemnant(r.w, r.h, settings))
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 5) // keep top-5 largest remnants
    .map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
}

function packWithOrder(
  sortedPieces: CuttingPiece[],
  sheetW: number,
  sheetH: number,
  settings: CuttingSettings,
): { sheets: CuttingSheet[]; unplaced: CuttingPiece[] } {
  const { gap_between_pieces: gap, edge_margin: e, allow_rotation: rotate } = settings
  const sw = sheetW - 2 * e
  const sh = sheetH - 2 * e

  const sheets: CuttingSheet[] = []
  const unplaced: CuttingPiece[] = []
  let curPieces: PlacedPiece[] = []
  let freeRects: FreeRect[] = [{ x: e, y: e, w: sw, h: sh }]

  const orderColorMap = new Map<number, number>()
  let nextColor = 0

  function pushSheet() {
    if (curPieces.length === 0) return
    const usedArea = curPieces.reduce((s, p) => s + p.w * p.h, 0)
    const remnants = significantRemnants(freeRects, e, settings)
    sheets.push({ index: sheets.length, pieces: curPieces, usedArea, totalArea: sheetW * sheetH, efficiency: Math.round(usedArea / (sheetW * sheetH) * 100), remnants })
    curPieces = []
    freeRects = [{ x: e, y: e, w: sw, h: sh }]
  }

  for (const piece of sortedPieces) {
    if (!orderColorMap.has(piece.orderId)) orderColorMap.set(piece.orderId, nextColor++)
    const colorIndex = orderColorMap.get(piece.orderId)!

    let p = tryPlace(piece, freeRects, gap, rotate, colorIndex)
    if (!p) { pushSheet(); p = tryPlace(piece, freeRects, gap, rotate, colorIndex) }
    if (!p) { unplaced.push(piece); continue }

    applyPlacement(p, freeRects, gap)
    curPieces.push(p.placed)
  }

  pushSheet()
  return { sheets, unplaced }
}

// ─── Strip packing (NFDH — Next Fit Decreasing Height) ───────────────────────
// Fills sheets row by row. Outperforms guillotine for similar-sized pieces.
// Each "strip" height = first piece placed in it. Pieces must fit within strip height.

// preferShortHeight=false: use normal orientation for new strips, rotate only when necessary.
// preferShortHeight=true:  always prefer shorter height (old greedy behaviour — still tried as fallback).
function packStrip(
  pieces: CuttingPiece[],
  sheetW: number,
  sheetH: number,
  settings: CuttingSettings,
  preferShortHeight = false,
): { sheets: CuttingSheet[]; unplaced: CuttingPiece[] } {
  const { gap_between_pieces: gap, edge_margin: e, allow_rotation: rotate } = settings
  const sheets: CuttingSheet[] = []
  const unplaced: CuttingPiece[] = []
  const ocm = new Map<number, number>()
  let nc = 0
  const col = (id: number) => { if (!ocm.has(id)) ocm.set(id, nc++); return ocm.get(id)! }

  let todo = [...pieces]

  while (todo.length > 0) {
    const cur: PlacedPiece[] = []
    const leftover: CuttingPiece[] = []
    const frects: FreeRect[] = []
    let Y = e
    let remaining = [...todo]
    let anyPlaced = false

    // Fill sheet strip by strip
    while (remaining.length > 0) {
      let X = e
      let H = 0            // strip height, set by first placed piece
      const notInStrip: CuttingPiece[] = []
      let stripStarted = false

      for (const p of remaining) {
        let pw = p.width + gap, ph = p.height + gap, rot = false
        if (rotate && p.canRotate && p.width !== p.height) {
          const rpw = p.height + gap, rph = p.width + gap
          const rotCond = H === 0
            // New strip: preferShortHeight → always rotate if shorter;
            //            otherwise → only rotate if normal won't fit but rotated will
            ? (preferShortHeight ? rph < ph : (Y + ph > sheetH - e && Y + rph <= sheetH - e))
            // In existing strip: rotate only if normal too tall but rotated fits
            : (ph > H && rph <= H)
          if (rotCond) { pw = rpw; ph = rph; rot = true }
          // Новая полоса шире листа: развернуть, если так влезает
          if (H === 0 && X + pw > sheetW - e && X + ph <= sheetW - e && Y + pw <= sheetH - e) {
            [pw, ph] = [ph, pw]; rot = !rot
          }
        }

        if (H === 0) {
          // Try to start a new strip. Ширину тоже: без неё деталь 3300 мм ложилась за край
          // листа 3210 и не попадала в нераскроенные (найдено 02.10.2026).
          if (Y + ph > sheetH - e || X + pw > sheetW - e) { leftover.push(p); continue }
          cur.push({ id: p.id, x: X, y: Y, w: rot ? p.height : p.width, h: rot ? p.width : p.height, rotated: rot, label: p.label, orderId: p.orderId, orderClientName: p.orderClientName, colorIndex: col(p.orderId) })
          H = ph; X += pw; stripStarted = true; anyPlaced = true
        } else if (ph <= H && X + pw <= sheetW - e) {
          // Fits in current strip
          cur.push({ id: p.id, x: X, y: Y, w: rot ? p.height : p.width, h: rot ? p.width : p.height, rotated: rot, label: p.label, orderId: p.orderId, orderClientName: p.orderClientName, colorIndex: col(p.orderId) })
          X += pw
        } else {
          notInStrip.push(p)
        }
      }

      if (!stripStarted) { leftover.push(...notInStrip); break }

      // Right-side remnant of this strip
      const rw = sheetW - e - X
      if (rw >= MIN_REMNANT_MM && H >= MIN_REMNANT_MM) frects.push({ x: X, y: Y, w: rw, h: H })

      Y += H
      remaining = notInStrip
    }

    // Bottom remnant
    const bh = sheetH - e - Y
    if (bh >= MIN_REMNANT_MM) frects.push({ x: e, y: Y, w: sheetW - 2 * e, h: bh })

    if (!anyPlaced) {
      // Nothing was placed on a fresh sheet — all remaining pieces are oversized.
      // leftover здесь — те же детали, что todo: раньше каждая попадала в список дважды.
      unplaced.push(...todo)
      break
    }

    const usedArea = cur.reduce((s, p) => s + p.w * p.h, 0)
    sheets.push({ index: sheets.length, pieces: cur, usedArea, totalArea: sheetW * sheetH, efficiency: Math.round(usedArea / (sheetW * sheetH) * 100), remnants: significantRemnants(frects, e, settings) })
    todo = leftover
  }

  return { sheets, unplaced }
}

// ─── Sort strategies ──────────────────────────────────────────────────────────

type SortFn = (a: CuttingPiece, b: CuttingPiece) => number

// Seeded pseudo-random for reproducible shuffles
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const SORT_STRATEGIES: Array<{ name: string; fn: SortFn }> = [
  { name: 'area_desc',      fn: (a, b) => b.width * b.height - a.width * a.height },
  { name: 'max_side_desc',  fn: (a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) },
  { name: 'min_side_desc',  fn: (a, b) => Math.min(b.width, b.height) - Math.min(a.width, a.height) },
  { name: 'perimeter_desc', fn: (a, b) => (b.width + b.height) - (a.width + a.height) },
  { name: 'width_desc',     fn: (a, b) => b.width - a.width },
  { name: 'height_desc',    fn: (a, b) => b.height - a.height },
  { name: 'area_asc',       fn: (a, b) => a.width * a.height - b.width * b.height },
  // square-first (aspect ratio close to 1)
  { name: 'square_first',   fn: (a, b) => Math.abs(1 - a.width / a.height) - Math.abs(1 - b.width / b.height) },
  // elongated first
  { name: 'elongated_first',fn: (a, b) => Math.abs(1 - b.width / b.height) - Math.abs(1 - a.width / a.height) },
]

const SHUFFLE_SEEDS = [42, 137, 271, 999, 1337, 2718, 3141, 7777, 8080, 9001]

// Sort orders to try with strip packing
const STRIP_SORT_FNS: SortFn[] = [
  (a, b) => b.height - a.height,                                              // NFDH: по высоте убыв.
  (a, b) => b.width - a.width,                                                // по ширине убыв.
  (a, b) => b.width * b.height - a.width * a.height,                          // по площади убыв.
  (a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height),        // по макс. стороне убыв.
]

function scoreSheets(sheets: CuttingSheet[]): [number, number] {
  // Primary: fewer sheets is better; Secondary: higher efficiency
  const totalEff = sheets.length > 0
    ? sheets.reduce((s, sh) => s + sh.efficiency, 0) / sheets.length
    : 0
  return [sheets.length, -totalEff]
}

const minUsed = (sheets: CuttingSheet[]) => sheets.reduce((m, s) => Math.min(m, s.usedArea), Infinity)
// Отход — свободное место, которое не стало остатком (его же считает lib/materialUsage.ts).
const cutLoss = (sheets: CuttingSheet[]) =>
  sheets.reduce((s, sh) => s + sh.totalArea - sh.usedArea - sh.remnants.reduce((a, r) => a + r.w * r.h, 0), 0)

// Меньше нераскроенных, затем меньше листов. При равном числе листов детали те же, и
// средний КПД равен с точностью до округления — сравнивать его значит выбирать шумом
// (100 шт 291×913: 23+23+23+23+8 проигрывали 20×5 из-за округления). Поэтому выигрывает
// раскрой, у которого самый пустой лист пустее хотя бы на минимальный остаток (400×800):
// свободное место собрано в один кусок, а не размазано полосами по всем листам, и хвост
// можно взять с остатка со стеллажа. Разница меньше — шум, решает меньший отход.
function isBetter(a: Packed, b: Packed, settings: CuttingSettings): boolean {
  if (a.unplaced.length !== b.unplaced.length) return a.unplaced.length < b.unplaced.length
  if (a.sheets.length !== b.sheets.length) return a.sheets.length < b.sheets.length
  const minRemnant = (settings.min_remnant_short ?? REMNANT_MIN_SHORT) * (settings.min_remnant_long ?? REMNANT_MIN_LONG)
  const am = minUsed(a.sheets), bm = minUsed(b.sheets)
  if (Math.abs(am - bm) >= minRemnant) return am < bm
  const al = cutLoss(a.sheets), bl = cutLoss(b.sheets)
  if (al !== bl) return al < bl
  return scoreSheets(a.sheets)[1] < scoreSheets(b.sheets)[1]
}

function makeSheet(index: number, pieces: PlacedPiece[], free: FreeRect[], sheetW: number, sheetH: number, settings: CuttingSettings): CuttingSheet {
  const usedArea = pieces.reduce((s, p) => s + p.w * p.h, 0)
  return { index, pieces, usedArea, totalArea: sheetW * sheetH, efficiency: Math.round(usedArea / (sheetW * sheetH) * 100), remnants: significantRemnants(free, settings.edge_margin, settings) }
}

// Цвет — по заказу, в порядке появления на листах: раскрой из двух частей иначе
// красил бы один заказ разными цветами.
function recolor(sheets: CuttingSheet[]): CuttingSheet[] {
  const byOrder = new Map<number, number>()
  return sheets.map((sh, index) => ({
    ...sh, index,
    pieces: sh.pieces.map(p => {
      if (!byOrder.has(p.orderId)) byOrder.set(p.orderId, byOrder.size)
      return { ...p, colorIndex: byOrder.get(p.orderId)! }
    }),
  }))
}

// Быстрый набор: гильотина по площади + две полосовые. Его же берёт блочная раскладка
// для хвоста.
function packQuick(pieces: CuttingPiece[], sheetW: number, sheetH: number, settings: CuttingSettings): Packed {
  const byArea   = [...pieces].sort((a, b) => b.width * b.height - a.width * a.height)
  const byHeight = [...pieces].sort((a, b) => b.height - a.height)
  return [packStrip(byHeight, sheetW, sheetH, settings, false), packStrip(byHeight, sheetW, sheetH, settings, true)]
    .reduce((b, s) => isBetter(s, b, settings) ? s : b, packWithOrder(byArea, sheetW, sheetH, settings))
}

// ─── Блочная раскладка однотипных деталей ─────────────────────────────────────
// BSSF и полосы не перебирают сетки. 291×913 на листе 3210×2250 они клали по 20 шт, а
// гильотинная сетка 10 стоя × 2 ряда + 3 лёжа в нижней полосе — 23; 291×656 — 28, а
// перебор находит 33 (один вертикальный рез: 4×3 стоя и 3×7 лёжа). Найдено 01.10.2026.
// Для типоразмера ищем лучшую раскладку листа точным перебором гильотинных резов: рез
// имеет смысл только там, где кончается целое число деталей (сумма их размеров с
// зазором), поэтому перебор идёт по этим координатам, а не по миллиметрам.

type Slot = { x: number; y: number; pw: number; ph: number; rot: boolean }
// Дерево резов: рез делит прямоугольник на a и b, конец ветки — блок nx×ny одной ориентации
// (pw×ph — шаг сетки с зазором) или пустой кусок. count — сколько деталей вмещает узел.
type PatternNode = FreeRect & { count: number } & (
  | { kind: 'split'; a: PatternNode; b: PatternNode }
  | { kind: 'block'; pw: number; ph: number; rot: boolean; nx: number; ny: number }
  | { kind: 'empty' }
)

// Перебор X×Y×(X+Y) координат резов; выше — только кратные одному размеру (для мелких
// деталей сумм тысячи, а блоки с полосами кратными всё равно находятся).
const PATTERN_BUDGET = 2_000_000

function cutPositions(sizes: number[], limit: number, sums: boolean): number[] {
  const ok = new Uint8Array(limit + 1)
  if (sums) {
    ok[0] = 1
    for (let v = 1; v <= limit; v++) for (const s of sizes) if (v >= s && ok[v - s]) { ok[v] = 1; break }
  } else {
    for (const s of sizes) for (let v = s; v <= limit; v += s) ok[v] = 1
  }
  const out: number[] = []
  for (let v = 1; v <= limit; v++) if (ok[v]) out.push(v)
  return out
}

// Индекс наибольшей координаты ≤ v (−1, если такой нет) — для всех v от 0 до limit.
function floorIndex(pos: number[], limit: number): Int32Array {
  const idx = new Int32Array(limit + 1).fill(-1)
  let k = -1
  for (let v = 0; v <= limit; v++) {
    while (k + 1 < pos.length && pos[k + 1] <= v) k++
    idx[v] = k
  }
  return idx
}

function sheetPattern(w: number, h: number, canRotate: boolean, U: number, V: number, gap: number, e: number): PatternNode | null {
  const orients = [{ pw: w + gap, ph: h + gap, rot: false }]
  if (canRotate && w !== h) orients.push({ pw: h + gap, ph: w + gap, rot: true })
  const ws = [...new Set(orients.map(o => o.pw))]
  const hs = [...new Set(orients.map(o => o.ph))]
  let X = cutPositions(ws, U, true), Y = cutPositions(hs, V, true)
  if (X.length * Y.length * (X.length + Y.length) > PATTERN_BUDGET) {
    X = cutPositions(ws, U, false); Y = cutPositions(hs, V, false)
  }
  if (!X.length || !Y.length) return null
  const ix = floorIndex(X, U), iy = floorIndex(Y, V)
  const nX = X.length, nY = Y.length

  // best[i,j] — сколько деталей влезает в X[i]×Y[j]; how: −1−o — блок ориентации o,
  // 1..nX — вертикальный рез по X[how−1], дальше — горизонтальный по Y[how−1−nX].
  const best = new Int32Array(nX * nY)
  const how = new Int32Array(nX * nY)
  for (let i = 0; i < nX; i++) {
    for (let j = 0; j < nY; j++) {
      let b = 0, c = -1
      orients.forEach((o, oi) => {
        const n = Math.floor(X[i] / o.pw) * Math.floor(Y[j] / o.ph)
        if (n > b) { b = n; c = -1 - oi }
      })
      for (let k = 0; k < nX && X[k] * 2 <= X[i]; k++) {
        const v = best[k * nY + j] + best[ix[X[i] - X[k]] * nY + j]
        if (v > b) { b = v; c = 1 + k }
      }
      for (let k = 0; k < nY && Y[k] * 2 <= Y[j]; k++) {
        const v = best[i * nY + k] + best[i * nY + iy[Y[j] - Y[k]]]
        if (v > b) { b = v; c = 1 + nX + k }
      }
      best[i * nY + j] = b
      how[i * nY + j] = c
    }
  }

  const build = (x: number, y: number, rw: number, rh: number): PatternNode => {
    const i = ix[rw], j = iy[rh]
    const empty: PatternNode = { kind: 'empty', x, y, w: rw, h: rh, count: 0 }
    if (i < 0 || j < 0) return empty
    const c = how[i * nY + j]
    if (c >= 1) {
      const vertical = c <= nX
      const s = vertical ? X[c - 1] : Y[c - 1 - nX]
      const a = vertical ? build(x, y, s, rh) : build(x, y, rw, s)
      const b = vertical ? build(x + s, y, rw - s, rh) : build(x, y + s, rw, rh - s)
      return { kind: 'split', x, y, w: rw, h: rh, a, b, count: a.count + b.count }
    }
    const o = orients[-1 - c]
    const nx = Math.floor(rw / o.pw), ny = Math.floor(rh / o.ph)
    if (nx * ny === 0) return empty
    return { kind: 'block', x, y, w: rw, h: rh, ...o, nx, ny, count: nx * ny }
  }
  const root = build(e, e, U, V)
  return root.count > 0 ? root : null
}

// Кладёт n деталей по дереву (n ≤ count) и отдаёт ячейки и свободные прямоугольники.
// Незанятое — цельными кусками (узел целиком, недобранный блок — полосой во всю сторону),
// а не россыпью пустых ячеек: ячейки узкие, и остаток листа не узнавался бы.
function layPattern(root: PatternNode, n: number, gap: number): { slots: Slot[]; free: FreeRect[] } {
  const slots: Slot[] = []
  const free: FreeRect[] = []
  const addFree = (x: number, y: number, fw: number, fh: number) => { if (fw > gap && fh > gap) free.push({ x, y, w: fw, h: fh }) }
  const lay = (node: PatternNode, m: number): void => {
    if (m <= 0 || node.kind === 'empty') { addFree(node.x, node.y, node.w, node.h); return }
    if (node.kind === 'split') {
      const ma = Math.min(m, node.a.count)
      lay(node.a, ma); lay(node.b, m - ma)
      return
    }
    const { x, y, w, h, pw, ph, rot, nx, ny } = node
    const cell = (q: number, r: number) => slots.push({ x: x + q * pw, y: y + r * ph, pw, ph, rot })
    if (m >= nx * ny) {
      for (let r = 0; r < ny; r++) for (let q = 0; q < nx; q++) cell(q, r)
      // Обрезок блока — как в applyPlacement: длинная полоса во всю сторону.
      const bw = nx * pw, bh = ny * ph
      if (w - bw >= h - bh) { addFree(x + bw, y, w - bw, h); addFree(x, y + bh, bw, h - bh) }
      else { addFree(x, y + bh, w, h - bh); addFree(x + bw, y, w - bw, bh) }
      return
    }
    // Недобранный блок: рядами или колонками — как останется больший цельный кусок.
    const rowsUsed = Math.ceil(m / nx), colsUsed = Math.ceil(m / ny)
    if (w * (h - rowsUsed * ph) >= (w - colsUsed * pw) * h) {
      const full = Math.floor(m / nx), k = m % nx
      for (let r = 0; r < full; r++) for (let q = 0; q < nx; q++) cell(q, r)
      for (let q = 0; q < k; q++) cell(q, full)
      if (full > 0) addFree(x + nx * pw, y, w - nx * pw, full * ph)
      if (k > 0) addFree(x + k * pw, y + full * ph, w - k * pw, ph)
      addFree(x, y + rowsUsed * ph, w, h - rowsUsed * ph)
    } else {
      const full = Math.floor(m / ny), k = m % ny
      for (let q = 0; q < full; q++) for (let r = 0; r < ny; r++) cell(q, r)
      for (let r = 0; r < k; r++) cell(full, r)
      if (full > 0) addFree(x, y + ny * ph, full * pw, h - ny * ph)
      if (k > 0) addFree(x + full * pw, y + k * ph, pw, h - k * ph)
      addFree(x + colsUsed * pw, y, w - colsUsed * pw, h)
    }
  }
  lay(root, n)
  return { slots, free }
}

// Каждый типоразмер от двух штук кроится своей лучшей раскладкой: целыми листами, а с
// partialLast — и последний неполный лист (выигрывает, когда это экономит лист: 22 шт
// 291×913 на одном листе вместо 20 + 2). В обрезки и незанятое — детали других
// типоразмеров, остальное — быстрым набором. null — раскладывать по блокам нечего.
function packBlocks(pieces: CuttingPiece[], sheetW: number, sheetH: number, settings: CuttingSettings, partialLast: boolean): Packed | null {
  const { gap_between_pieces: gap, edge_margin: e, allow_rotation: rotate } = settings
  const U = sheetW - 2 * e, V = sheetH - 2 * e
  if (U <= 0 || V <= 0) return null

  const byType = new Map<string, CuttingPiece[]>()
  for (const p of pieces) {
    const turn = rotate && p.canRotate && p.width !== p.height
    const k = `${p.width}x${p.height}:${turn ? 1 : 0}`
    const list = byType.get(k)
    if (list) list.push(p); else byType.set(k, [p])
  }
  const area = (p: CuttingPiece) => p.width * p.height
  const types = [...byType.values()]
    .filter(t => t.length >= 2)
    .sort((a, b) => b.length * area(b[0]) - a.length * area(a[0]))

  const left = new Set(pieces)
  const sheets: CuttingSheet[] = []
  for (const type of types) {
    const p0 = type[0]
    const root = sheetPattern(p0.width, p0.height, rotate && p0.canRotate, U, V, gap, e)
    const cap = root?.count ?? 0
    if (!root || cap < 2) continue
    let queue = type.filter(p => left.has(p))
    while (queue.length >= cap || (partialLast && queue.length > 0)) {
      const take = queue.slice(0, cap)
      queue = queue.slice(cap)
      const { slots, free } = layPattern(root, take.length, gap)
      const placed: PlacedPiece[] = take.map((p, n) => {
        const s = slots[n]
        left.delete(p)
        return { id: p.id, x: s.x, y: s.y, w: s.rot ? p.height : p.width, h: s.rot ? p.width : p.height, rotated: s.rot, label: p.label, orderId: p.orderId, orderClientName: p.orderClientName, colorIndex: 0 }
      })
      for (const p of [...left].sort((a, b) => area(b) - area(a))) {
        const pl = tryPlace(p, free, gap, rotate, 0)
        if (!pl) continue
        applyPlacement(pl, free, gap)
        placed.push(pl.placed)
        left.delete(p)
      }
      sheets.push(makeSheet(sheets.length, placed, free, sheetW, sheetH, settings))
    }
  }
  if (!sheets.length) return null

  const tail = packQuick([...left], sheetW, sheetH, settings)
  return { sheets: recolor([...sheets, ...tail.sheets]), unplaced: tail.unplaced }
}

// Блочная раскладка — кандидат наравне с остальными: заменяет найденное, только если лучше.
function tryBlocks(best: Packed, pieces: CuttingPiece[], sheetW: number, sheetH: number, settings: CuttingSettings): { best: Packed; tried: number } {
  let tried = 0
  for (const partialLast of [false, true]) {
    const r = packBlocks(pieces, sheetW, sheetH, settings, partialLast)
    if (!r) continue
    tried++
    if (isBetter(r, best, settings)) best = r
  }
  return { best, tried }
}

// ─── Multi-strategy optimizer ─────────────────────────────────────────────────

function optimizePack(
  pieces: CuttingPiece[],
  sheetW: number,
  sheetH: number,
  settings: CuttingSettings,
  maxMs = 1500,
): { sheets: CuttingSheet[]; unplaced: CuttingPiece[]; strategiesChecked: number } {
  let best = packWithOrder(pieces, sheetW, sheetH, settings)
  let checked = 1
  const deadline = Date.now() + maxMs

  // Try all fixed sort strategies
  for (const s of SORT_STRATEGIES) {
    if (Date.now() > deadline) break
    const sorted = [...pieces].sort(s.fn)
    const result = packWithOrder(sorted, sheetW, sheetH, settings)
    checked++
    if (isBetter(result, best, settings)) best = result
  }

  // Try seeded shuffles
  for (const seed of SHUFFLE_SEEDS) {
    if (Date.now() > deadline) break
    const shuffled = seededShuffle(pieces, seed)
    const result = packWithOrder(shuffled, sheetW, sheetH, settings)
    checked++
    if (isBetter(result, best, settings)) best = result

    // Also try: sort by area, then shuffle ties
    if (Date.now() > deadline) break
    const sortedShuffled = seededShuffle([...pieces].sort(SORT_STRATEGIES[0].fn), seed)
    const result2 = packWithOrder(sortedShuffled, sheetW, sheetH, settings)
    checked++
    if (isBetter(result2, best, settings)) best = result2
  }

  // Try strip packing strategies — better for similar-sized pieces
  // preferShortHeight=false: normal orientation first, rotate only when strip too short (better for mixed sizes)
  // preferShortHeight=true:  always prefer shorter height (better for pure uniform-size cases)
  for (const preferShort of [false, true]) {
    for (const fn of STRIP_SORT_FNS) {
      if (Date.now() > deadline) break
      const sorted = [...pieces].sort(fn)
      const result = packStrip(sorted, sheetW, sheetH, settings, preferShort)
      checked++
      if (isBetter(result, best, settings)) best = result
    }
  }

  // Блочная — вне дедлайна: она дешёвая, а для серий одинаковых деталей главная.
  const blocks = tryBlocks(best, pieces, sheetW, sheetH, settings)
  best = blocks.best
  checked += blocks.tried

  return { sheets: best.sheets, unplaced: best.unplaced, strategiesChecked: checked }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export type SheetFormat = { width: number; height: number }

export type PieceGroup = {
  pieces: CuttingPiece[]
  materialLabel: string
  category: string
  sheetWidth: number
  sheetHeight: number
  patternDirection: 'none' | 'along_length' | 'along_width'
  // Доступные форматы листа (b2b_material_sheet_variants). Если заданы — раскрой
  // перебирает их и выбирает оптимальный; иначе кроит на sheetWidth×sheetHeight.
  sheetFormats?: SheetFormat[]
}

// Кандидаты форматов листа для группы: заданные варианты или единственный дефолт.
// Дедуп по W×H, отбрасываем некорректные размеры.
function candidateFormats(group: PieceGroup): SheetFormat[] {
  const raw = (group.sheetFormats && group.sheetFormats.length)
    ? group.sheetFormats
    : [{ width: group.sheetWidth, height: group.sheetHeight }]
  const seen = new Set<string>()
  const out: SheetFormat[] = []
  for (const f of raw) {
    if (!(f.width > 0) || !(f.height > 0)) continue
    const k = `${f.width}x${f.height}`
    if (seen.has(k)) continue
    seen.add(k); out.push({ width: f.width, height: f.height })
  }
  return out.length ? out : [{ width: group.sheetWidth, height: group.sheetHeight }]
}

type FormatTrial = { width: number; height: number; sheets: CuttingSheet[]; unplaced: CuttingPiece[] }

// Лучший формат: сначала меньше нераскроенных (деталь может не влезть в мелкий
// лист), затем меньше листов, затем меньше суммарная площадь листов (меньше
// закупки/отходов), затем выше средний КПД.
function pickBestFormat(trials: FormatTrial[]): FormatTrial {
  return trials.reduce((best, c) => {
    if (c.unplaced.length !== best.unplaced.length) return c.unplaced.length < best.unplaced.length ? c : best
    if (c.sheets.length !== best.sheets.length) return c.sheets.length < best.sheets.length ? c : best
    const ca = c.sheets.length * c.width * c.height
    const ba = best.sheets.length * best.width * best.height
    if (ca !== ba) return ca < ba ? c : best
    return scoreSheets(c.sheets)[1] < scoreSheets(best.sheets)[1] ? c : best
  })
}

function buildResult(
  materialKey: string,
  group: PieceGroup,
  sheetWidth: number,
  sheetHeight: number,
  sheets: CuttingSheet[],
  unplacedPieces: CuttingPiece[],
  strategiesChecked?: number,
): MaterialCuttingResult {
  const totalUsedArea  = sheets.reduce((s, sh) => s + sh.usedArea, 0)
  const totalSheetArea = sheets.length * sheetWidth * sheetHeight
  const avgEfficiency  = totalSheetArea > 0 ? Math.round(totalUsedArea / totalSheetArea * 100) : 0
  return {
    materialKey, materialLabel: group.materialLabel, category: group.category,
    sheetWidth, sheetHeight, patternDirection: group.patternDirection,
    sheets, totalPieces: group.pieces.length, sheetsNeeded: sheets.length,
    totalUsedArea, totalSheetArea, avgEfficiency, strategiesChecked,
    unplacedPieces, unplacedCount: unplacedPieces.length,
  }
}

function effectiveSettings(group: PieceGroup, settings: CuttingSettings): { settings: CuttingSettings; pieces: CuttingPiece[] } {
  const noRotate = settings.respect_pattern && group.patternDirection !== 'none'
  const pieces = noRotate ? group.pieces.map(p => ({ ...p, canRotate: false })) : group.pieces
  return { settings: { ...settings, allow_rotation: noRotate ? false : settings.allow_rotation }, pieces }
}

// Рисунок (МОРУ, Эстриадо): полоса на изделии идёт по ВЫСОТЕ детали, на листе — вдоль
// направления рисунка. Запретить поворот мало: без разворота высота детали ложится по оси Y
// листа, то есть поперёк длины 3210 — высокая деталь «не влезает» в 2250, а раскрой
// теряет её (проверено 15.09 на 12 заказах с МОРУ: 7 ломались). Поэтому деталь заранее
// кладём высотой вдоль полосы и поворот запрещаем.
export function patternSwap(dir: PieceGroup['patternDirection'], sheetW: number, sheetH: number): boolean {
  if (dir === 'none') return false
  const lengthAlongX = sheetW >= sheetH
  return (dir === 'along_length') === lengthAlongX
}

function orientPieces(pieces: CuttingPiece[], swap: boolean): CuttingPiece[] {
  return swap ? pieces.map(p => ({ ...p, width: p.height, height: p.width })) : pieces
}

// Результат — в исходных размерах деталей: развёрнутые помечаются rotated, нераскроенные
// возвращаются как были заданы.
function restoreOrientation(
  res: { sheets: CuttingSheet[]; unplaced: CuttingPiece[] },
  original: CuttingPiece[],
  swap: boolean,
): { sheets: CuttingSheet[]; unplaced: CuttingPiece[] } {
  if (!swap) return res
  const byId = new Map(original.map(p => [p.id, p]))
  return {
    sheets: res.sheets.map(sh => ({ ...sh, pieces: sh.pieces.map(pl => ({ ...pl, rotated: !pl.rotated })) })),
    unplaced: res.unplaced.map(p => byId.get(p.id) ?? p),
  }
}

/** Fast optimizer: guillotine (area-desc) + strip (height-desc) + блочная раскладка, picks better. */
export function runCuttingOptimizer(
  groups: Map<string, PieceGroup>,
  settings: CuttingSettings,
): MaterialCuttingResult[] {
  const results: MaterialCuttingResult[] = []

  for (const [materialKey, group] of groups) {
    const { settings: eff, pieces } = effectiveSettings(group, settings)
    const trials: FormatTrial[] = candidateFormats(group).map(f => {
      const swap = eff.respect_pattern && patternSwap(group.patternDirection, f.width, f.height)
      const oriented = orientPieces(pieces, swap)
      const { best } = tryBlocks(packQuick(oriented, f.width, f.height, eff), oriented, f.width, f.height, eff)
      const restored = restoreOrientation(best, pieces, swap)
      return { width: f.width, height: f.height, sheets: restored.sheets, unplaced: restored.unplaced }
    })
    const chosen = pickBestFormat(trials)
    results.push(buildResult(materialKey, group, chosen.width, chosen.height, chosen.sheets, chosen.unplaced))
  }

  return results.sort((a, b) => a.materialLabel.localeCompare(b.materialLabel))
}

/** Multi-strategy optimizer — tries N sort orders and picks the best result. */
export function runCuttingOptimizerOptimized(
  groups: Map<string, PieceGroup>,
  settings: CuttingSettings,
  timeLimitPerGroupMs = 1500,
): MaterialCuttingResult[] {
  const results: MaterialCuttingResult[] = []

  for (const [materialKey, group] of groups) {
    const { settings: eff, pieces } = effectiveSettings(group, settings)
    const formats = candidateFormats(group)
    const trials = formats.map(f => {
      const swap = eff.respect_pattern && patternSwap(group.patternDirection, f.width, f.height)
      const { sheets, unplaced, strategiesChecked } = optimizePack(orientPieces(pieces, swap), f.width, f.height, eff, timeLimitPerGroupMs)
      const restored = restoreOrientation({ sheets, unplaced }, pieces, swap)
      return { width: f.width, height: f.height, sheets: restored.sheets, unplaced: restored.unplaced, strategiesChecked }
    })
    const chosen = pickBestFormat(trials)
    const checked = trials.reduce((s, t) => s + (t.strategiesChecked ?? 0), 0)
    results.push(buildResult(materialKey, group, chosen.width, chosen.height, chosen.sheets, chosen.unplaced, checked))
  }

  return results.sort((a, b) => a.materialLabel.localeCompare(b.materialLabel))
}
