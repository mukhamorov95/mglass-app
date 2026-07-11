// Себестоимость лофт-изделий для B2B по реальному конструктиву цеха:
// несущий профиль 40×20×1.5; штапик 15×15×1.5 С ДВУХ СТОРОН стекла — одна
// сторона приваривается, вторая прикручивается через бонки с резьбой в 40×20;
// на штапик клеится Е-уплотнитель (оконный) с обеих сторон; стекло 4 мм.
// Работа сварщика — ₽/м² изделия; покраска порошковая по RAL — ₽/печку
// (один лофт помещается в одну печку). Ставки — из таблицы loft_rates.
// Детерминированный чистый TypeScript — никакого LLM в ценах.

export type LoftRates = Record<string, number>

export type LoftConstruction = 'fixed' | 'swing' | 'sliding'
export type LoftHandle = 'corner' | 'push'   // уголок 25×25 | нажимная с замком

export type LoftFactoryInputs = {
  widthMm: number             // проём, ширина
  heightMm: number            // проём, высота
  construction: LoftConstruction
  doors: number               // подвижных створок (распашных дверей / раздвижных)
  fixedParts: number          // глухих частей (для fixed — общее число секций)
  rows: number                // стёкол по вертикали в створке/секции
  handle: LoftHandle          // для swing
  softClose: boolean          // для sliding
  glassCostPerM2: number
  glassName: string
  tempering: boolean
  temperingCostPerM2: number
}

export type LoftCostLine = { name: string; qty: number; unit: string; price: number; total: number; note?: string }

export type LoftFactoryResult = {
  areaM2: number
  profileM: number        // пог.м трубы 40×20
  shtapikM: number        // пог.м трубы 15×15 (обе стороны)
  bonkaPoints: number     // точек крепежа (бонка+винт+отверстие)
  glassCount: number
  glassAreaM2: number
  weightKg: number
  costLines: LoftCostLine[]
  totalCost: number
  spec: string
}

// Конструктивные константы (мм) — сверены с чертежом Л-30-05:
// проём 1288 при двух створках → полотно 614 (суммарный зазор 60).
const PROFILE = 40           // видимая сторона несущей трубы
const GAP_BASE = 30          // зазоры к коробке (сумма боковых)
const GAP_PER_LEAF = 15      // зазор на створку/стык
const DOOR_H_OFFSET = 50     // высота створки = H − (короб сверху + зазор снизу)
const GLASS_REBATE = 15      // запуск стекла за штапик, на сторону
const BONKA_STEP = 300       // шаг точек крепежа штапика, мм
// Вес, кг/пог.м: 40×20×1.5 ≈ 1.35; 15×15×1.5 ≈ 0.63; стекло 4 мм = 10 кг/м²
const W_PROFILE = 1.35
const W_SHTAPIK = 0.63

const r2 = (n: number) => Math.round(n * 100) / 100

export function calcLoftFactory(p: LoftFactoryInputs, rates: LoftRates): LoftFactoryResult | null {
  const W = p.widthMm, H = p.heightMm
  if (W <= 0 || H <= 0) return null
  const rate = (k: string) => Number(rates[k]) || 0
  const rows = Math.max(1, p.rows)
  const doors = p.construction === 'fixed' ? 0 : Math.max(0, p.doors)
  const fixedParts = p.construction === 'fixed' ? Math.max(1, p.fixedParts) : Math.max(0, p.fixedParts)
  const leaves = doors + fixedParts        // всех «рам» в проёме
  if (leaves < 1) return null

  // ── Геометрия ──────────────────────────────────────────────────────────
  // Обвязка проёма: распашная — П-образная коробка (2H + W); остальные — контур.
  const frameMm = p.construction === 'swing' ? 2 * H + W : 2 * (W + H)
  // Сверено с чертежом Л-30-05: проём 1288, две створки → полотно 614 (зазор 60).
  const leafW = (W - GAP_BASE - GAP_PER_LEAF * leaves) / leaves
  const leafH = H - DOOR_H_OFFSET
  if (leafW <= PROFILE * 3 || leafH <= PROFILE * 3) return null

  // Рамы створок/секций + горизонтальные перемычки
  const leafFrameMm = leaves * 2 * (leafW + leafH)
  const innerW = leafW - 2 * PROFILE
  const innerH = leafH - 2 * PROFILE
  const barsMm = leaves * (rows - 1) * innerW
  const profileM = (frameMm + leafFrameMm + barsMm) / 1000

  // Стёкла: просвет между перемычками + запуск за штапик
  const glassH = (innerH - (rows - 1) * PROFILE) / rows
  if (innerW <= 0 || glassH <= 0) return null
  const gW = (innerW + 2 * GLASS_REBATE) / 1000
  const gH = (glassH + 2 * GLASS_REBATE) / 1000
  const glassCount = leaves * rows
  const glassPerimM = 2 * (gW + gH) * glassCount
  const glassAreaNetM2 = gW * gH * glassCount

  // Штапик 15×15 с ДВУХ сторон стекла; бонки — на прикрутной стороне с шагом 300 мм
  const shtapikM = glassPerimM * 2
  const bonkaPoints = Math.ceil((glassPerimM * 1000) / BONKA_STEP)
  // Е-уплотнитель на оба штапика
  const sealM = glassPerimM * 2
  // Притвор (полоса 30×2) — на распашных дверях
  const pritvorM = p.construction === 'swing' && doors > 0 ? (doors * leafH) / 1000 : 0

  const lines: LoftCostLine[] = []

  // ── Металл по сечениям ────────────────────────────────────────────────
  lines.push({
    name: 'Труба 40×20×1,5 (обвязка, рамы, перемычки)', qty: r2(profileM), unit: 'пог.м',
    price: rate('profile_40x20'), total: Math.round(profileM * rate('profile_40x20')),
    note: `обвязка ${r2(frameMm / 1000)} + рамы ${r2(leafFrameMm / 1000)} + перемычки ${r2(barsMm / 1000)}`,
  })
  lines.push({
    name: 'Штапик 15×15×1,5 (с двух сторон стекла)', qty: r2(shtapikM), unit: 'пог.м',
    price: rate('profile_shtapik'), total: Math.round(shtapikM * rate('profile_shtapik')),
  })
  if (bonkaPoints > 0 && rate('bonka') > 0) lines.push({
    name: 'Бонки, винты, сверловка', qty: bonkaPoints, unit: 'точка',
    price: rate('bonka'), total: Math.round(bonkaPoints * rate('bonka')),
    note: `отверстий ≈ ${bonkaPoints}`,
  })
  if (pritvorM > 0 && rate('strip_pritvor') > 0) lines.push({
    name: 'Притвор — полоса 30×2', qty: r2(pritvorM), unit: 'пог.м',
    price: rate('strip_pritvor'), total: Math.round(pritvorM * rate('strip_pritvor')),
  })
  if (rate('seal') > 0) lines.push({
    name: 'Е-уплотнитель (обе стороны)', qty: r2(sealM), unit: 'пог.м',
    price: rate('seal'), total: Math.round(sealM * rate('seal')),
  })

  // ── Фурнитура по типу конструкции ─────────────────────────────────────
  const specParts: string[] = []
  if (p.construction === 'swing' && doors > 0) {
    const hingesPerLeaf = leafH >= 2300 ? 3 : 2
    const hinges = hingesPerLeaf * doors
    if (rate('hinge') > 0) lines.push({ name: 'Петли приварные', qty: hinges, unit: 'шт', price: rate('hinge'), total: Math.round(hinges * rate('hinge')) })
    if (p.handle === 'push' && rate('push_handle') > 0)
      lines.push({ name: 'Ручка нажимная с замком', qty: doors, unit: 'шт', price: rate('push_handle'), total: Math.round(doors * rate('push_handle')) })
    else if (rate('handle_set') > 0)
      lines.push({ name: 'Ручки (уголок 25×25)', qty: doors, unit: 'створка', price: rate('handle_set'), total: Math.round(doors * rate('handle_set')) })
    specParts.push(`распашная · ${doors} дв.${fixedParts ? ` + ${fixedParts} глух.` : ''}`,
      p.handle === 'push' ? 'ручка нажимная с замком' : 'ручка-уголок')
  } else if (p.construction === 'sliding' && doors > 0) {
    if (rate('track_kit') > 0) lines.push({ name: 'Раздвижная система (трек-комплект)', qty: doors, unit: 'створка', price: rate('track_kit'), total: Math.round(doors * rate('track_kit')) })
    if (p.softClose && rate('soft_close') > 0) lines.push({ name: 'Доводчик', qty: doors, unit: 'шт', price: rate('soft_close'), total: Math.round(doors * rate('soft_close')) })
    specParts.push(`раздвижная · ${doors} ств.${fixedParts ? ` + ${fixedParts} глух.` : ''}`, p.softClose ? 'с доводчиком' : 'без доводчика')
  } else {
    specParts.push(`стационарная · ${fixedParts} секц.`)
  }

  // ── Стекло ────────────────────────────────────────────────────────────
  const waste = 1 + Math.max(0, rate('glass_waste_pct')) / 100
  const glassAreaM2 = glassAreaNetM2 * waste
  lines.push({
    name: p.glassName, qty: r2(glassAreaM2), unit: 'м²', price: p.glassCostPerM2,
    total: Math.round(glassAreaM2 * p.glassCostPerM2),
    note: `${glassCount} шт ~${Math.round(gW * 1000)}×${Math.round(gH * 1000)}, отход ${rate('glass_waste_pct')}%`,
  })
  if (p.tempering && p.temperingCostPerM2 > 0)
    lines.push({ name: 'Закалка', qty: r2(glassAreaM2), unit: 'м²', price: p.temperingCostPerM2, total: Math.round(glassAreaM2 * p.temperingCostPerM2) })

  // ── Работы ────────────────────────────────────────────────────────────
  const metalM = profileM + shtapikM + pritvorM
  const areaM2 = (W * H) / 1_000_000
  if (rate('consumables_m') > 0)
    lines.push({ name: 'Расходники (диски, проволока, грунт)', qty: r2(metalM), unit: 'пог.м металла', price: rate('consumables_m'), total: Math.round(metalM * rate('consumables_m')) })
  if (rate('weld_m2') > 0)
    lines.push({ name: 'Работа сварщика', qty: r2(areaM2), unit: 'м²', price: rate('weld_m2'), total: Math.round(areaM2 * rate('weld_m2')) })
  if (rate('paint_oven') > 0)
    lines.push({ name: 'Покраска порошковая (RAL)', qty: 1, unit: 'печка', price: rate('paint_oven'), total: Math.round(rate('paint_oven')) })
  // Сборка — ₽/м² изделия (ставка glazing_m2); старая ставка ₽/стекло — фолбэк
  if (rate('glazing_m2') > 0)
    lines.push({ name: 'Остекление и сборка', qty: r2(areaM2), unit: 'м²', price: rate('glazing_m2'), total: Math.round(areaM2 * rate('glazing_m2')) })
  else if (rate('glazing_glass') > 0)
    lines.push({ name: 'Остекление и сборка', qty: glassCount, unit: 'стекло', price: rate('glazing_glass'), total: Math.round(glassCount * rate('glazing_glass')) })

  const totalCost = lines.reduce((s, l) => s + l.total, 0)
  const weightKg = profileM * W_PROFILE + shtapikM * W_SHTAPIK + glassAreaNetM2 * 10

  return {
    areaM2: r2(areaM2),
    profileM: r2(profileM),
    shtapikM: r2(shtapikM),
    bonkaPoints,
    glassCount,
    glassAreaM2: r2(glassAreaM2),
    weightKg: Math.round(weightKg * 10) / 10,
    costLines: lines,
    totalCost: Math.round(totalCost),
    spec: [
      ...specParts,
      `створка ${Math.round(leafW)}×${Math.round(leafH)}`,
      `${rows} стекла по вертикали`,
      p.glassName,
      p.tempering ? 'закалка' : null,
      'покраска RAL',
    ].filter(Boolean).join(' · '),
  }
}
