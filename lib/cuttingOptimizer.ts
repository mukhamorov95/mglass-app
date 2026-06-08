// 2D Guillotine Bin Packing for glass cutting
// Algorithm: Best Short Side Fit (BSSF) + guillotine split
// Multi-strategy optimization: runs N sort orders, picks the best result.

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
}

export const DEFAULT_CUTTING_SETTINGS: CuttingSettings = {
  gap_between_pieces: 2,
  edge_margin: 2,
  allow_rotation: true,
  respect_pattern: true,
}

// ─── Internal types ────────────────────────────────────────────────────────────

type FreeRect = { x: number; y: number; w: number; h: number }
type Placement = { rectIdx: number; placed: PlacedPiece }

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

// Minimum remnant size to show (mm) — smaller ones are not worth showing
const MIN_REMNANT_MM = 200

function significantRemnants(freeRects: FreeRect[], e: number): Remnant[] {
  return freeRects
    .filter(r => r.w >= MIN_REMNANT_MM && r.h >= MIN_REMNANT_MM)
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
    const remnants = significantRemnants(freeRects, e)
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
        }

        if (H === 0) {
          // Try to start a new strip
          if (Y + ph > sheetH - e) { leftover.push(p); continue }
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
      // Nothing was placed on a fresh sheet — all remaining pieces are oversized
      unplaced.push(...todo, ...leftover)
      break
    }

    const usedArea = cur.reduce((s, p) => s + p.w * p.h, 0)
    sheets.push({ index: sheets.length, pieces: cur, usedArea, totalArea: sheetW * sheetH, efficiency: Math.round(usedArea / (sheetW * sheetH) * 100), remnants: significantRemnants(frects, e) })
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

function isBetter(a: CuttingSheet[], b: CuttingSheet[]): boolean {
  const [al, ae] = scoreSheets(a)
  const [bl, be] = scoreSheets(b)
  if (al !== bl) return al < bl
  return ae < be
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
    if (isBetter(result.sheets, best.sheets)) best = result
  }

  // Try seeded shuffles
  for (const seed of SHUFFLE_SEEDS) {
    if (Date.now() > deadline) break
    const shuffled = seededShuffle(pieces, seed)
    const result = packWithOrder(shuffled, sheetW, sheetH, settings)
    checked++
    if (isBetter(result.sheets, best.sheets)) best = result

    // Also try: sort by area, then shuffle ties
    if (Date.now() > deadline) break
    const sortedShuffled = seededShuffle([...pieces].sort(SORT_STRATEGIES[0].fn), seed)
    const result2 = packWithOrder(sortedShuffled, sheetW, sheetH, settings)
    checked++
    if (isBetter(result2.sheets, best.sheets)) best = result2
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
      if (isBetter(result.sheets, best.sheets)) best = result
    }
  }

  return { sheets: best.sheets, unplaced: best.unplaced, strategiesChecked: checked }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export type PieceGroup = {
  pieces: CuttingPiece[]
  materialLabel: string
  category: string
  sheetWidth: number
  sheetHeight: number
  patternDirection: 'none' | 'along_length' | 'along_width'
}

function buildResult(
  materialKey: string,
  group: PieceGroup,
  sheets: CuttingSheet[],
  unplacedPieces: CuttingPiece[],
  strategiesChecked?: number,
): MaterialCuttingResult {
  const totalUsedArea  = sheets.reduce((s, sh) => s + sh.usedArea, 0)
  const totalSheetArea = sheets.length * group.sheetWidth * group.sheetHeight
  const avgEfficiency  = totalSheetArea > 0 ? Math.round(totalUsedArea / totalSheetArea * 100) : 0
  return {
    materialKey, materialLabel: group.materialLabel, category: group.category,
    sheetWidth: group.sheetWidth, sheetHeight: group.sheetHeight, patternDirection: group.patternDirection,
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

/** Fast optimizer: tries guillotine (area-desc) + strip (height-desc), picks better. */
export function runCuttingOptimizer(
  groups: Map<string, PieceGroup>,
  settings: CuttingSettings,
): MaterialCuttingResult[] {
  const results: MaterialCuttingResult[] = []

  for (const [materialKey, group] of groups) {
    const { settings: eff, pieces } = effectiveSettings(group, settings)
    const byArea   = [...pieces].sort((a, b) => b.width * b.height - a.width * a.height)
    const byHeight = [...pieces].sort((a, b) => b.height - a.height)
    const guillotine  = packWithOrder(byArea, group.sheetWidth, group.sheetHeight, eff)
    const stripNormal = packStrip(byHeight, group.sheetWidth, group.sheetHeight, eff, false)
    const stripShort  = packStrip(byHeight, group.sheetWidth, group.sheetHeight, eff, true)
    const best = [stripNormal, stripShort].reduce(
      (b, s) => isBetter(s.sheets, b.sheets) ? s : b,
      guillotine,
    )
    results.push(buildResult(materialKey, group, best.sheets, best.unplaced))
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
    const { sheets, unplaced, strategiesChecked } = optimizePack(pieces, group.sheetWidth, group.sheetHeight, eff, timeLimitPerGroupMs)
    results.push(buildResult(materialKey, group, sheets, unplaced, strategiesChecked))
  }

  return results.sort((a, b) => a.materialLabel.localeCompare(b.materialLabel))
}
