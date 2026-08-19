import type { Configuration } from '@/lib/configurator/catalog'
import type { MModel, Seg } from '@/lib/configurator/arrangement'

// Чистый билдер 3D-геометрии из параметрической конфигурации.
// Топология зеркалит проверенный изо-рендер (PartitionIso): фронт вдоль X,
// глубина ниши вдоль Z, высота вдоль Y. Угловые складываются под 90° (боковое
// стекло уходит в +Z при x=0). Единицы наружу — МЕТРЫ (мм × 0.001), чтобы сцена
// строилась в реальном масштабе (высота 2000 мм = 2 м). Никаких импортов three —
// функция детерминированная и покрывается юнит-тестом.

const M = 0.001
const SWING_DEG = 20            // на сколько приоткрыта распашная дверь в визуале
const SLIDE_GAP = 40 * M        // вынос раздвижной створки по Z (передний рельс)
const PROFILE = 26 * M          // сечение профиля/штанги в визуале
const TUBE_DROP = 0.06          // ось штанги 30×10 у раздвижных — на 60 мм ниже верха стекла

export type GlassPart = {
  key: string
  pos: [number, number, number]     // центр, м
  size: [number, number, number]    // ширина(X), высота(Y), толщина(Z), м
  rotY: number                      // поворот вокруг вертикали, рад
  role: 'fixed' | 'door' | 'return'
}

export type MetalPart = {
  key: string
  pos: [number, number, number]
  size: [number, number, number]
  rotY: number
  kind: 'profile' | 'rail' | 'post'
}

// Реальная фурнитура-модель (точки установки; геометрия — в scene/hardware.tsx).
export type HardwarePlacement = {
  key: string
  model: 'balge' | 'dessau' | 'sd210' | 'roller' | 'kp006' | 'kupe' | 'cap' | 'kp002' | 'kp001' | 'connector'
  pos: [number, number, number]
  rotY: number
}

// Облицованная ниша вокруг кабины (Фаза 1): стёкла закрывают открытые стороны,
// плиткой облицованы остальные. Угловая — глухие стены сзади и справа; прямая —
// «стакан» из задней + двух боковых. depth — глубина ниши по Z.
export type Niche = {
  w: number            // ширина ниши по X (= фронтовой пролёт), м
  depth: number        // глубина по Z, м
  wallH: number        // высота стен, м
  trayH: number        // высота поддона, м
  walls: { back: boolean; left: boolean; right: boolean }
}

export type Assembly = {
  glass: GlassPart[]
  metal: MetalPart[]
  hardware: HardwarePlacement[]
  niche: Niche
  bounds: { w: number; d: number; h: number }   // габарит сцены, м (для камеры)
  center: [number, number, number]
}

const NICHE_DEFAULT_DEPTH = 0.9   // глубина «стакана» для прямых типов, м
const TRAY_H = 0.06               // поддон, м

export function buildAssembly(config: Configuration): Assembly {
  const { dims, thickness, type } = config
  const hingeCode = config.hinge?.code ?? ''
  const t = thickness * M
  const H = dims.height * M
  const La = dims.width * M                       // фронтовой пролёт
  const corner = type.corner
  const Lb = corner ? (dims.width2 ?? 0) * M : 0   // боковой пролёт (вдоль Z)
  const sliding = type.group === 'sliding'
  const hasDoor = !!type.constraints.doorWidth || sliding
  const doorLen = type.constraints.doorWidth
    ? (dims.doorWidth ?? 600) * M
    : sliding ? La * 0.5 : 0
  const fixedLen = Math.max(0, La - doorLen)

  const glass: GlassPart[] = []
  const metal: MetalPart[] = []

  // ── Боковое стекло угловой (складка 90°): вдоль Z при x≈0 ──
  if (corner && Lb > 0) {
    glass.push({
      key: 'return', role: 'return', rotY: Math.PI / 2,
      pos: [t / 2, H / 2, Lb / 2], size: [Lb, H, t],
    })
  }

  // ── Фронтовые стёкла ──
  if (!hasDoor) {
    // Стационар / шторка — цельная панель
    glass.push({ key: 'fixed', role: 'fixed', rotY: 0, pos: [La / 2, H / 2, 0], size: [La, H, t] })
  } else if (sliding) {
    // Неподвижная створка (задний план) + раздвижная (передний рельс)
    glass.push({ key: 'fixed', role: 'fixed', rotY: 0, pos: [fixedLen / 2, H / 2, 0], size: [fixedLen, H, t] })
    glass.push({ key: 'door', role: 'door', rotY: 0, pos: [La - doorLen / 2, H / 2, SLIDE_GAP], size: [doorLen, H, t] })
  } else {
    // Распашная: неподвижная часть + дверь, приоткрытая вокруг петлевой кромки (x=fixedLen)
    if (fixedLen > 0)
      glass.push({ key: 'fixed', role: 'fixed', rotY: 0, pos: [fixedLen / 2, H / 2, 0], size: [fixedLen, H, t] })
    const a = (SWING_DEG * Math.PI) / 180
    const cx = fixedLen + (doorLen / 2) * Math.cos(a)
    const cz = (doorLen / 2) * Math.sin(a)
    glass.push({ key: 'door', role: 'door', rotY: -a, pos: [cx, H / 2, cz], size: [doorLen, H, t] })
  }

  // ── Металл: профили, штанга, стойки ──
  const bottomY = PROFILE / 2
  const topY = H - PROFILE / 2
  // фронт: нижний профиль + верхняя штанга
  metal.push({ key: 'front-bottom', kind: 'profile', rotY: 0, pos: [La / 2, bottomY, 0], size: [La, PROFILE, PROFILE] })
  metal.push({ key: 'front-top', kind: 'rail', rotY: 0, pos: [La / 2, topY, 0], size: [La, PROFILE * 0.7, PROFILE * 0.7] })
  // угловая стойка (стекло-стекло) и правая стойка
  metal.push({ key: 'post-corner', kind: 'post', rotY: 0, pos: [0, H / 2, 0], size: [PROFILE * 0.6, H, PROFILE * 0.6] })
  metal.push({ key: 'post-right', kind: 'post', rotY: 0, pos: [La, H / 2, 0], size: [PROFILE * 0.6, H, PROFILE * 0.6] })
  if (corner && Lb > 0) {
    metal.push({ key: 'side-bottom', kind: 'profile', rotY: Math.PI / 2, pos: [0, bottomY, Lb / 2], size: [Lb, PROFILE, PROFILE] })
    metal.push({ key: 'side-top', kind: 'rail', rotY: Math.PI / 2, pos: [0, topY, Lb / 2], size: [Lb, PROFILE * 0.7, PROFILE * 0.7] })
    metal.push({ key: 'post-back', kind: 'post', rotY: 0, pos: [0, H / 2, Lb], size: [PROFILE * 0.6, H, PROFILE * 0.6] })
  }

  // ── Реальная фурнитура на распашной двери: петли + ручка-скоба ──
  const hardware: HardwarePlacement[] = []
  if (hasDoor && !sliding && doorLen > 0) {
    const a = (SWING_DEG * Math.PI) / 180
    const hingeModel = /dessau/i.test(hingeCode) ? 'dessau' as const : 'balge' as const
    // Правило M-Glass: ≤700×2200 → 2 петли (250 мм от краёв), иначе 3.
    const hingeN = dims.width <= 1400 && doorLen <= 0.7 && H <= 2.2 ? 2 : 3
    const ys = hingeN === 2 ? [0.25, H - 0.25] : [0.25, H / 2, H - 0.25]
    // Петля стоит на петлевой кромке (пивот, x=fixedLen), развёрнута на пол-угла.
    for (let i = 0; i < ys.length; i++)
      hardware.push({ key: `hinge-${i}`, model: hingeModel, rotY: -a / 2, pos: [fixedLen, ys[i], 0] })
    // Ручка у внешней кромки двери, следует повороту двери.
    const frac = 0.86
    hardware.push({
      key: 'handle', model: 'sd210', rotY: -a,
      pos: [fixedLen + doorLen * frac * Math.cos(a), H / 2, doorLen * frac * Math.sin(a)],
    })
  }

  // ── Ниша (Фаза 1) ──
  const depth = corner && Lb > 0 ? Lb : NICHE_DEFAULT_DEPTH
  const niche: Niche = {
    w: La,
    depth,
    wallH: Math.max(2.2, H + 0.25),
    trayH: TRAY_H,
    // Угловая: стёкла спереди (z=0) и слева (x=0) → глухие стены сзади и справа.
    // Прямая: стекло только спереди → «стакан» из задней + обеих боковых.
    walls: { back: true, right: true, left: !corner },
  }

  const w = La
  const d = depth
  const center: [number, number, number] = [w / 2, H / 2, d / 2]
  return { glass, metal, hardware, niche, bounds: { w, d, h: H }, center }
}

// ────────────────────────────────────────────────────────────────────────
// Новый билдер: строит 3D строго по РАСКЛАДКЕ модели (lib/configurator/arrangement).
// Плоскость XZ — план (вид сверху): фронт вдоль X, глубина вдоль Z, высота Y.
// Стёкла — вертикальные панели вдоль «ранов»; распашная дверь открывается НАРУЖУ
// (в сторону outward-нормали рана); петля на своей стороне (к стеклу/стене).
export type MDims = { width: number; height: number; width2?: number; doorWidth?: number }

const DOOR_OPEN_DEG = 32       // распашная приоткрыта заметнее (визуальное разведение со стационаром)
const SLIDE_OPEN = 0.28        // раздвижная приоткрыта: доля длины створки, сдвинутой вдоль штанги
type P = [number, number]   // точка плана [x, z], метры

export function buildFromModel(model: MModel, dims: MDims, thickness: number): Assembly {
  const t = thickness * M
  const H = dims.height * M
  const W = dims.width * M
  const W2 = (dims.width2 ?? 900) * M
  const glass: GlassPart[] = []
  const metal: MetalPart[] = []
  const hardware: HardwarePlacement[] = []
  const hingeModel: 'balge' | 'dessau' = /trap/.test(model.shape) ? 'dessau' : 'balge'

  // Координаты — локальные (сборка потом поднимается на поддон group[y=trayH]),
  // поэтому НЕ прибавляем TRAY_H (иначе профиль всплывал на ~60 мм над стеклом).
  const bottomY = 0.0125 / 2                       // нижний П-профиль Pr-002 18×12.5 — на поддоне, у низа стекла
  const topY = H - 0.006                           // штанга 30×10 у верха

  // Вертикальная стеклянная панель вдоль отрезка плана A→B. При zOff (створка)
  // смещаем внутрь: если задан out — по −out, иначе по нормали сегмента.
  const addGlass = (key: string, A: P, B: P, role: GlassPart['role'], zOff = 0, out?: P) => {
    const cx = (A[0] + B[0]) / 2, cz = (A[1] + B[1]) / 2
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz)
    const rotY = Math.atan2(-dz, dx)
    const nx = L ? -dz / L : 0, nz = L ? dx / L : 0   // нормаль панели
    const ox = out ? -out[0] * zOff : nx * zOff, oz = out ? -out[1] * zOff : nz * zOff
    glass.push({ key, role, rotY, pos: [cx + ox, H / 2, cz + oz], size: [L, H, t] })
    return { cx, cz, L, rotY }
  }
  const tubeYSlide = H - TUBE_DROP   // раздвижная — труба на ~60 мм ниже верха (шапка над трубой)
  const tubeYSwing = H - 0.02        // распашная — труба почти вровень с верхом стекла

  // Нижний П-профиль Pr-002 всегда. Верх (topKind): 'slide' — труба ниже верха (по ней
  // ролики); 'swing' — труба почти вровень с верхом; 'flush' — штанга у верха (стационар
  // М1); 'none' — верха нет (большой боковой стационар М7). Труба лежит «на пузе»:
  // 10 высота, 30 глубина; смещена внутрь на SLIDE_GAP (её держат КП-006/002/001).
  const addRails = (kp: string, A: P, B: P, topKind: 'slide' | 'swing' | 'flush' | 'none', out: P) => {
    const cx = (A[0] + B[0]) / 2, cz = (A[1] + B[1]) / 2
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz), rotY = Math.atan2(-dz, dx)
    metal.push({ key: kp + '-bot', kind: 'profile', rotY, pos: [cx, bottomY, cz], size: [L, 0.0125, 0.018] })  // Pr-002 18×12.5
    if (topKind === 'none') return
    const offset = topKind !== 'flush'
    const y = topKind === 'slide' ? tubeYSlide : topKind === 'swing' ? tubeYSwing : topY
    const ox = offset ? -out[0] * SLIDE_GAP : 0, oz = offset ? -out[1] * SLIDE_GAP : 0   // труба смещена внутрь
    // раздвижная: труба 30 высота × 10 глубина (по ней ролики); распашная/трапеция:
    // «на пузе» — 10 высота × 30 глубина.
    const size: [number, number, number] = topKind === 'slide' ? [L, 0.030, 0.010] : [L, 0.010, 0.030]
    metal.push({ key: kp + '-top', kind: 'rail', rotY, pos: [cx + ox, y, cz + oz], size })
  }
  const addPost = (key: string, p: P) =>
    metal.push({ key, kind: 'post', rotY: 0, pos: [p[0], H / 2, p[1]], size: [PROFILE * 0.55, H, PROFILE * 0.55] })

  const seg2 = (A: P, B: P) => {
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz)
    return { ux: dx / L, uz: dz / L, nx: -dz / L, nz: dx / L, L, rotY: Math.atan2(-dz, dx) }
  }
  // Раздвижная створка РД-001: две каретки по трубе СВЕРХУ + ручка-купе.
  // Смещение — строго внутрь душевой (−out).
  const addSlideDoor = (key: string, A: P, B: P, out: P) => {
    const { ux, uz, L, rotY } = seg2(A, B)
    if (!L) return
    const ox = -out[0] * SLIDE_GAP, oz = -out[1] * SLIDE_GAP
    const at = (f: number, y: number) => [A[0] + ux * L * f + ox, y, A[1] + uz * L * f + oz] as [number, number, number]
    ;[0.24, 0.76].forEach((f, i) => {
      hardware.push({ key: `${key}-r${i}`, model: 'roller', rotY, pos: at(f, tubeYSlide) })
    })
    hardware.push({ key: `${key}-kupe`, model: 'kupe', rotY, pos: at(0.82, H / 2) })
  }
  // КП-006 — крепёж трубы к стеклу, на стационаре ближе к двери. Вынос — к трубе
  // (внутрь); если +нормаль сегмента смотрит наружу, разворот кронштейна на π.
  const addKP006 = (key: string, A: P, B: P, frac: number, y: number, out: P) => {
    const { ux, uz, nx, nz, L, rotY } = seg2(A, B)
    if (!L) return
    const flip = (nx * -out[0] + nz * -out[1]) < 0 ? Math.PI : 0
    hardware.push({ key: `${key}-kp006`, model: 'kp006', rotY: rotY + flip, pos: [A[0] + ux * L * frac, y, A[1] + uz * L * frac] })
  }
  // Торцы трубы: у A — КП-002 (к стене); у B — КП-002 либо КП-001 (угол М7). Смещение внутрь.
  const addTubeEnds = (kp: string, A: P, B: P, y: number, bModel: 'kp002' | 'kp001', out: P) => {
    const { rotY } = seg2(A, B)
    const ox = -out[0] * SLIDE_GAP, oz = -out[1] * SLIDE_GAP
    hardware.push({ key: `${kp}-endA`, model: 'kp002', rotY, pos: [A[0] + ox, y, A[1] + oz] })
    hardware.push({ key: `${kp}-endB`, model: bModel, rotY, pos: [B[0] + ox, y, B[1] + oz] })
  }

  // Дверь: открыта наружу вокруг петлевой кромки Ph; ставит петли и ручку.
  const addDoor = (key: string, Ph: P, Pf: P, outward: P) => {
    const L = Math.hypot(Pf[0] - Ph[0], Pf[1] - Ph[1])
    const dc: P = [(Pf[0] - Ph[0]) / L, (Pf[1] - Ph[1]) / L]
    const phi = (DOOR_OPEN_DEG * Math.PI) / 180, ca = Math.cos(phi), sa = Math.sin(phi)
    const od: P = [dc[0] * ca + outward[0] * sa, dc[1] * ca + outward[1] * sa]  // открытое направление
    const Pfo: P = [Ph[0] + L * od[0], Ph[1] + L * od[1]]
    const cx = (Ph[0] + Pfo[0]) / 2, cz = (Ph[1] + Pfo[1]) / 2
    const rotY = Math.atan2(-od[1], od[0])
    glass.push({ key, role: 'door', rotY, pos: [cx, H / 2, cz], size: [L, H, t] })
    // петли на петлевой кромке
    const n = L > 0.7 || H > 2.2 ? 3 : 2
    const ys = n === 2 ? [0.28, H - 0.28] : [0.28, H / 2, H - 0.28]
    for (let i = 0; i < ys.length; i++)
      hardware.push({ key: `${key}-h${i}`, model: hingeModel, rotY, pos: [Ph[0], ys[i], Ph[1]] })
    // ручка у внешней кромки, с наружной стороны двери
    const hx = Ph[0] + od[0] * L * 0.82, hz = Ph[1] + od[1] * L * 0.82
    const nx = -od[1], nz = od[0]
    hardware.push({ key: `${key}-handle`, model: 'sd210', rotY, pos: [hx + nx * outward[0] * 0.02, H / 2, hz + nz * 0] })
  }

  // Раны плана по форме модели.
  type Run3 = { kp: string; A: P; B: P; out: P; segs: Seg[] }
  const runs: Run3[] = []
  let depth: number, walls: Niche['walls']
  const front = model.runs.find(r => r.edge === 'front')
  const side = model.runs.find(r => r.edge === 'side')

  if (model.shape === 'walkin') {
    depth = 0.9; walls = { back: true, left: true, right: false }   // задняя+левая стена — панель стоит в углу, не «в воздухе»
    const part = front?.part ?? 0.62
    runs.push({ kp: 'w', A: [0, 0], B: [W * part, 0], out: [0, -1], segs: front!.segs })
  } else if (model.shape === 'niche') {
    depth = NICHE_DEFAULT_DEPTH; walls = { back: true, left: true, right: true }
    runs.push({ kp: 'f', A: [0, 0], B: [W, 0], out: [0, -1], segs: front!.segs })
  } else if (model.shape === 'corner') {
    depth = W2; walls = { back: true, left: true, right: false }
    runs.push({ kp: 's', A: [W, W2], B: [W, 0], out: [1, 0], segs: side!.segs })
    runs.push({ kp: 'f', A: [0, 0], B: [W, 0], out: [0, -1], segs: front!.segs })
  } else { // trap — пятигранник: срез угла диагональю 135°
    depth = W2; walls = { back: true, left: true, right: false }
    const c = Math.min(W, W2) * 0.5
    runs.push({ kp: 'r', A: [W, W2], B: [W, c], out: [1, 0], segs: [{ t: 'fixed' }] })
    runs.push({ kp: 'd', A: [W, c], B: [W - c, 0], out: [0.707, -0.707], segs: [{ t: 'door', hinge: 'a' }] })
    runs.push({ kp: 'g', A: [W - c, 0], B: [0, 0], out: [0, -1], segs: [{ t: 'fixed' }] })
  }

  // Обход ранов: стёкла/двери/раздвижные + профили.
  for (const run of runs) {
    const n = run.segs.length
    const sliding = run.segs.some(s => s.t === 'slide')
    const swing = run.segs.some(s => s.t === 'door')
    // М7: над большим боковым стационаром трубы нет; на фронте труба приходит к
    // боковому стеклу перпендикулярно (КП-001 в углу вместо КП-002).
    const isM7 = model.shape === 'corner' && model.group === 'swing'
    const isM7Side = isM7 && run.kp === 's'
    const isM7Front = isM7 && run.kp === 'f'
    const isTrap = model.shape === 'trap'   // все раны — со смещённой трубой (на пузе)
    const topKind: 'slide' | 'swing' | 'flush' | 'none' = isM7Side ? 'none' : sliding ? 'slide' : (swing || isTrap) ? 'swing' : 'flush'
    addRails(run.kp, run.A, run.B, topKind, run.out)
    const hasTube = topKind === 'slide' || topKind === 'swing'
    const runY = sliding ? tubeYSlide : tubeYSwing
    // Торцы трубы: у трапеции стыки закрывает соединитель (ниже), КП-002 не ставим.
    if (hasTube && !isTrap) addTubeEnds(run.kp, run.A, run.B, runY, isM7Front ? 'kp001' : 'kp002', run.out)
    const rL = Math.hypot(run.B[0] - run.A[0], run.B[1] - run.A[1])
    const rux = rL ? (run.B[0] - run.A[0]) / rL : 0, ruz = rL ? (run.B[1] - run.A[1]) / rL : 0
    for (let i = 0; i < n; i++) {
      const sa: P = [run.A[0] + (run.B[0] - run.A[0]) * i / n, run.A[1] + (run.B[1] - run.A[1]) * i / n]
      const sb: P = [run.A[0] + (run.B[0] - run.A[0]) * (i + 1) / n, run.A[1] + (run.B[1] - run.A[1]) * (i + 1) / n]
      const sg = run.segs[i]
      const key = run.kp + i
      if (sg.t === 'fixed') {
        addGlass(key, sa, sb, 'fixed')
        if (hasTube) {   // КП-006 труба→стекло, ближе к двери/створке
          const frac = (i < n - 1 && run.segs[i + 1].t !== 'fixed') ? 0.82
            : (i > 0 && run.segs[i - 1].t !== 'fixed') ? 0.18 : 0.5
          addKP006(key, sa, sb, frac, runY, run.out)
        }
      }
      else if (sg.t === 'slide') {
        // приоткрываем створку вдоль штанги к началу рана: перекрывает соседний
        // стационар (спереди) и открывает проём — читается как раздвижная.
        const shift = (rL / n) * SLIDE_OPEN
        const oa: P = [sa[0] - rux * shift, sa[1] - ruz * shift]
        const ob: P = [sb[0] - rux * shift, sb[1] - ruz * shift]
        addGlass(key, oa, ob, 'door', SLIDE_GAP, run.out); addSlideDoor(key, oa, ob, run.out)
      } else {
        const Ph = sg.hinge === 'a' ? sa : sb
        const Pf = sg.hinge === 'a' ? sb : sa
        addDoor(key, Ph, Pf, run.out)
      }
    }
  }
  // Трапеция: соединители труб на углах + КП-002 на внешних торцах (у стен).
  if (model.shape === 'trap') {
    const c = Math.min(W, W2) * 0.5
    const dir = (a: P, b: P): P => { const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L] }
    const rotOf = (d: P) => Math.atan2(-d[1], d[0])
    const outs: Record<string, P> = { r: [1, 0], d: [0.707, -0.707], g: [0, -1] }
    const dR = dir([W, W2], [W, c]), dD = dir([W, c], [W - c, 0]), dG = dir([W - c, 0], [0, 0])
    const conn = (p: P, outA: P, outB: P, dA: P, dB: P, key: string) => {
      const ox = -(outA[0] + outB[0]), oz = -(outA[1] + outB[1]), ol = Math.hypot(ox, oz) || 1
      hardware.push({ key, model: 'connector', rotY: (rotOf(dA) + rotOf(dB)) / 2, pos: [p[0] + ox / ol * SLIDE_GAP, tubeYSwing, p[1] + oz / ol * SLIDE_GAP] })
    }
    conn([W, c], outs.r, outs.d, dR, dD, 'conn1')
    conn([W - c, 0], outs.d, outs.g, dD, dG, 'conn2')
    hardware.push({ key: 'trap-endR', model: 'kp002', rotY: rotOf(dR), pos: [W - outs.r[0] * SLIDE_GAP, tubeYSwing, W2 - outs.r[1] * SLIDE_GAP] })
    hardware.push({ key: 'trap-endG', model: 'kp002', rotY: rotOf(dG), pos: [0 - outs.g[0] * SLIDE_GAP, tubeYSwing, 0 - outs.g[1] * SLIDE_GAP] })
  }

  // Стойки на стыках стекло-стена/угол.
  addPost('p-corner', [0, 0])
  if (model.shape === 'niche') addPost('p-right', [W, 0])
  if (model.shape === 'corner' || model.shape === 'trap') addPost('p-back', [W, depth])

  const niche: Niche = {
    w: W, depth, wallH: Math.max(2.2, H + 0.25), trayH: TRAY_H, walls,
  }
  return { glass, metal, hardware, niche, bounds: { w: W, d: depth, h: H }, center: [W / 2, H / 2, depth / 2] }
}
