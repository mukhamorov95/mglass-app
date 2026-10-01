// Чек-лист «деталь готова для цеха» (docs/DRAWING_INTAKE_ROUTE.md, Ч3). Проверяет код,
// не модель: на вход — деталь, прочитанная с чертежа или введённая руками, на выход —
// что блокирует запуск и что спросить. Красное нельзя отправить в работу, жёлтое — можно,
// менеджер увидит. Числа правил сверловки даёт цех: пока их нет (rules без edgeMin…),
// эти проверки молчат, а не выдумывают норму.

export type ShopHole = { d: number | null; x: number | null; y: number | null }   // центр от левого нижнего угла, мм
export type ShopCutout = { w: number | null; h: number | null; x: number | null; y: number | null }

export type ShopPart = {
  label?: string
  width: number | null
  height: number | null
  thickness: number | null
  material: string | null
  quantity: number | null
  isMirror: boolean
  tempering: boolean | null          // null — на чертеже не сказано
  shape: 'rect' | 'curved'
  blankWidth?: number | null         // габарит заготовки фигурной детали
  blankHeight?: number | null
  holes: ShopHole[]
  holesSeen?: number | null          // сколько отверстий видно на чертеже, даже без размеров
  cutouts: ShopCutout[]
}

export type ShopRules = {
  // Лист материала ≈7,22 м² (3210 × 2250) — так закупаем (второй мозг, «Производство»).
  sheet: { long: number; short: number }
  edgeMin?: (t: number) => number    // от края стекла до края отверстия
  gapMin?: (t: number) => number     // между краями соседних отверстий
  diameterMin?: (t: number) => number
}

export const DEFAULT_SHOP_RULES: ShopRules = { sheet: { long: 3210, short: 2250 } }

export type ShopIssueCode =
  | 'size_missing' | 'thickness_missing' | 'material_missing' | 'quantity_missing'
  | 'too_big_for_sheet' | 'tempering_unknown' | 'mirror_tempering'
  | 'hole_no_diameter' | 'hole_no_position' | 'hole_outside' | 'holes_count_mismatch'
  | 'hole_near_edge' | 'holes_too_close' | 'hole_too_small'
  | 'cutout_no_size' | 'cutout_no_position' | 'curved_no_blank'

export type ShopIssue = { part: number; code: ShopIssueCode; severity: 'block' | 'warn'; ask: string }

const pos = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export function checkPartForShop(p: ShopPart, part = 0, rules: ShopRules = DEFAULT_SHOP_RULES): ShopIssue[] {
  const out: ShopIssue[] = []
  const add = (code: ShopIssueCode, severity: 'block' | 'warn', ask: string) => out.push({ part, code, severity, ask })
  const name = p.label ? `«${p.label}»` : `деталь ${part + 1}`

  if (!pos(p.width) || !pos(p.height)) add('size_missing', 'block', `Укажите ширину и высоту: ${name}`)
  if (!pos(p.thickness)) add('thickness_missing', 'block', `Укажите толщину: ${name}`)
  if (!p.material?.trim()) add('material_missing', 'block', `Какое стекло или зеркало: ${name}?`)
  if (!pos(p.quantity)) add('quantity_missing', 'block', `Сколько штук: ${name}?`)

  if (pos(p.width) && pos(p.height)) {
    const long = Math.max(p.width, p.height), short = Math.min(p.width, p.height)
    if (long > rules.sheet.long || short > rules.sheet.short)
      add('too_big_for_sheet', 'block', `${name} ${p.width} × ${p.height} больше листа ${rules.sheet.long} × ${rules.sheet.short} — разбить на части?`)
  }

  if (p.isMirror && p.tempering === true) add('mirror_tempering', 'block', `Зеркало не закаляется: ${name} — убрать закалку или это стекло?`)
  if (!p.isMirror && p.tempering == null) add('tempering_unknown', 'warn', `Закалка нужна: ${name}?`)

  if (p.shape === 'curved' && (!pos(p.blankWidth) || !pos(p.blankHeight)))
    add('curved_no_blank', 'block', `Фигурная деталь ${name}: нужен габарит заготовки или чертёж с размерами контура`)

  p.holes.forEach((h, i) => {
    const n = `отверстие ${i + 1} (${name})`
    if (!pos(h.d)) add('hole_no_diameter', 'block', `Диаметр: ${n}`)
    if (!num(h.x) || !num(h.y)) { add('hole_no_position', 'block', `Расстояния от двух краёв до центра: ${n}`); return }
    if (pos(p.width) && pos(p.height)) {
      const r = pos(h.d) ? h.d / 2 : 0
      if (h.x - r < 0 || h.y - r < 0 || h.x + r > p.width || h.y + r > p.height) add('hole_outside', 'block', `${n} выходит за край детали — проверьте размеры`)
      else if (pos(h.d) && pos(p.thickness) && rules.edgeMin) {
        const edge = Math.min(h.x - r, h.y - r, p.width - h.x - r, p.height - h.y - r)
        if (edge < rules.edgeMin(p.thickness)) add('hole_near_edge', 'warn', `${n}: ${Math.round(edge)} мм до края — меньше нормы цеха ${rules.edgeMin(p.thickness)} мм`)
      }
    }
    if (pos(h.d) && pos(p.thickness) && rules.diameterMin && h.d < rules.diameterMin(p.thickness))
      add('hole_too_small', 'warn', `${n}: ⌀${h.d} меньше нормы цеха ⌀${rules.diameterMin(p.thickness)} для ${p.thickness} мм`)
  })

  if (rules.gapMin && pos(p.thickness)) {
    const placed = p.holes.filter(h => pos(h.d) && num(h.x) && num(h.y)) as { d: number; x: number; y: number }[]
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j]
      const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.d / 2 - b.d / 2
      if (gap < rules.gapMin(p.thickness)) { add('holes_too_close', 'warn', `${name}: отверстия ближе ${rules.gapMin(p.thickness)} мм друг к другу`); i = placed.length; break }
    }
  }

  if (num(p.holesSeen) && p.holesSeen > p.holes.length)
    add('holes_count_mismatch', 'block', `${name}: на чертеже ${p.holesSeen} отв., с размерами — ${p.holes.length}. Укажите остальные`)

  p.cutouts.forEach((c, i) => {
    const n = `вырез ${i + 1} (${name})`
    if (!pos(c.w) || !pos(c.h)) add('cutout_no_size', 'block', `Размеры: ${n}`)
    if (!num(c.x) || !num(c.y)) add('cutout_no_position', 'block', `Привязка к краям: ${n}`)
  })

  return out
}

export function checkPartsForShop(parts: ShopPart[], rules: ShopRules = DEFAULT_SHOP_RULES) {
  const issues = parts.flatMap((p, i) => checkPartForShop(p, i, rules))
  const blocking = issues.filter(i => i.severity === 'block').length
  return { issues, blocking, warnings: issues.length - blocking, ready: blocking === 0 }
}
