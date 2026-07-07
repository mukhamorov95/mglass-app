// Себестоимость лофт-изделий для B2B: честная модель по конструктиву цеха
// (коробка/полотно — труба 40×20, штапик 15×15, притвор — полоса 30×2, петли
// приварные, ручки-уголки). Металл, расходники, сварка и покраска — по пог.м
// металла; остекление — за стекло; ставки — из таблицы loft_rates.
// Детерминированный чистый TypeScript — никакого LLM в ценах.

export type LoftRates = Record<string, number>

export type LoftFactoryInputs = {
  widthMm: number
  heightMm: number
  doors: 0 | 1 | 2            // 0 = глухая перегородка
  rowsPerLeaf: number         // стёкол по вертикали в створке (по чертежу Л-30-05 = 3)
  sections: number            // для глухой: вертикальных секций
  divisions: number           // для глухой: горизонтальных делений
  glassCostPerM2: number      // себестоимость стекла, ₽/м² (COST из матрицы)
  glassName: string
  tempering: boolean
  temperingCostPerM2: number  // ₽/м² (0 = закалки нет в справочнике)
}

export type LoftCostLine = { name: string; qty: number; unit: string; price: number; total: number; note?: string }

export type LoftFactoryResult = {
  areaM2: number          // габаритная площадь изделия
  metalM: number          // пог.м всего металла (труба+штапик+полоса)
  glassCount: number
  glassAreaM2: number     // с отходом
  weightKg: number
  costLines: LoftCostLine[]
  totalCost: number
  spec: string
}

// Конструктивные константы модели (мм) — сверены с чертежом Л-30-05:
// проём 1288 при двух створках даёт полотно 614 → суммарный зазор 60.
const PROFILE = 40          // видимая ширина трубы полотна/коробки
const GAP_TWO_DOORS = 60    // проём − 2 полотна
const GAP_ONE_DOOR = 55
const DOOR_H_OFFSET = 50    // высота полотна = H − (короб сверху + зазоры + низ 10)
const GLASS_REBATE = 20     // запуск стекла в фальц, на сторону
// Вес, кг/пог.м: труба 40×20×1.5 ≈ 1.35; штапик 15×15×1.5 ≈ 0.63; стекло 4 мм = 10 кг/м²
const W_PROFILE = 1.35
const W_SHTAPIK = 0.63

const r2 = (n: number) => Math.round(n * 100) / 100

export function calcLoftFactory(p: LoftFactoryInputs, rates: LoftRates): LoftFactoryResult | null {
  const W = p.widthMm, H = p.heightMm
  if (W <= 0 || H <= 0) return null
  const rate = (k: string) => Number(rates[k]) || 0

  const lines: LoftCostLine[] = []
  let profileMm = 0      // труба 40×20
  let shtapikMm = 0      // труба 15×15
  let pritvorMm = 0      // полоса 30×2
  let glassCount = 0
  let glassAreaNetM2 = 0
  let glassPerimM = 0    // периметры стёкол, м (штапик и уплотнитель)
  const specParts: string[] = []

  if (p.doors > 0) {
    // ── Распашной блок: коробка + створки ────────────────────────────────
    const rows = Math.max(1, p.rowsPerLeaf)
    const doorW = p.doors === 2 ? (W - GAP_TWO_DOORS) / 2 : W - GAP_ONE_DOOR
    const doorH = H - DOOR_H_OFFSET
    if (doorW <= PROFILE * 3 || doorH <= PROFILE * 3) return null

    profileMm += 2 * H + W                                   // коробка (П, без порога)
    profileMm += p.doors * 2 * (doorW + doorH)               // рамы створок
    profileMm += p.doors * (rows - 1) * (doorW - 2 * PROFILE) // перемычки

    // Стёкла: просвет рамы минус перемычки, плюс запуск в фальц
    const inW = doorW - 2 * PROFILE
    const inH = doorH - 2 * PROFILE
    const glassH = (inH - (rows - 1) * PROFILE) / rows
    if (inW <= 0 || glassH <= 0) return null
    const gW = (inW + 2 * GLASS_REBATE) / 1000
    const gH = (glassH + 2 * GLASS_REBATE) / 1000
    glassCount = p.doors * rows
    glassAreaNetM2 = gW * gH * glassCount
    glassPerimM = 2 * (gW + gH) * glassCount
    shtapikMm = glassPerimM * 1000
    pritvorMm = doorH * Math.max(1, p.doors - 0)             // притвор на стык/примыкание каждой створки

    const hingesPerLeaf = doorH >= 2300 ? 3 : 2
    const hinges = hingesPerLeaf * p.doors
    if (rate('hinge') > 0) lines.push({ name: 'Петли приварные', qty: hinges, unit: 'шт', price: rate('hinge'), total: Math.round(hinges * rate('hinge')) })
    if (rate('handle_set') > 0) lines.push({ name: 'Ручки (уголок 25×25)', qty: p.doors, unit: 'створка', price: rate('handle_set'), total: Math.round(p.doors * rate('handle_set')) })

    specParts.push(p.doors === 2 ? 'двустворчатая распашная' : 'одностворчатая распашная',
      `полотно ${Math.round(doorW)}×${Math.round(doorH)}`, `${rows} стекла в створке`)
  } else {
    // ── Глухая перегородка: контур + стойки + перемычки ─────────────────
    const S = Math.max(1, p.sections), D = Math.max(0, p.divisions)
    profileMm += 2 * (W + H) + (S - 1) * H + D * S * (W / S - 2 * PROFILE)
    const cellW = W / S - 2 * PROFILE
    const cellH = (H - 2 * PROFILE - D * PROFILE) / (D + 1)
    if (cellW <= 0 || cellH <= 0) return null
    const gW = (cellW + 2 * GLASS_REBATE) / 1000
    const gH = (cellH + 2 * GLASS_REBATE) / 1000
    glassCount = S * (D + 1)
    glassAreaNetM2 = gW * gH * glassCount
    glassPerimM = 2 * (gW + gH) * glassCount
    shtapikMm = glassPerimM * 1000
    specParts.push('глухая', `${S} секц. × ${D + 1} стекол`)
  }

  const profileM = profileMm / 1000
  const shtapikM = shtapikMm / 1000
  const pritvorM = pritvorMm / 1000
  const metalM = profileM + shtapikM + pritvorM

  // Металл
  lines.unshift(
    { name: 'Труба 40×20 (коробка, полотно, перемычки)', qty: r2(profileM), unit: 'пог.м', price: rate('profile_40x20'), total: Math.round(profileM * rate('profile_40x20')) },
    { name: 'Штапик 15×15', qty: r2(shtapikM), unit: 'пог.м', price: rate('profile_shtapik'), total: Math.round(shtapikM * rate('profile_shtapik')) },
  )
  if (pritvorM > 0 && rate('strip_pritvor') > 0)
    lines.push({ name: 'Притвор — полоса 30×2', qty: r2(pritvorM), unit: 'пог.м', price: rate('strip_pritvor'), total: Math.round(pritvorM * rate('strip_pritvor')) })
  if (rate('seal') > 0)
    lines.push({ name: 'Уплотнитель', qty: r2(glassPerimM), unit: 'пог.м', price: rate('seal'), total: Math.round(glassPerimM * rate('seal')) })

  // Стекло (+ закалка)
  const waste = 1 + Math.max(0, rate('glass_waste_pct')) / 100
  const glassAreaM2 = glassAreaNetM2 * waste
  lines.push({
    name: `${p.glassName}`, qty: r2(glassAreaM2), unit: 'м²', price: p.glassCostPerM2,
    total: Math.round(glassAreaM2 * p.glassCostPerM2),
    note: `${glassCount} шт, отход ${rate('glass_waste_pct')}%`,
  })
  if (p.tempering && p.temperingCostPerM2 > 0)
    lines.push({ name: 'Закалка', qty: r2(glassAreaM2), unit: 'м²', price: p.temperingCostPerM2, total: Math.round(glassAreaM2 * p.temperingCostPerM2) })

  // Работы и расходники — от метража металла
  if (rate('consumables_m') > 0)
    lines.push({ name: 'Расходники', qty: r2(metalM), unit: 'пог.м металла', price: rate('consumables_m'), total: Math.round(metalM * rate('consumables_m')) })
  if (rate('weld_m') > 0)
    lines.push({ name: 'Работа сварщика', qty: r2(metalM), unit: 'пог.м металла', price: rate('weld_m'), total: Math.round(metalM * rate('weld_m')) })
  if (rate('paint_m') > 0) {
    const paint = Math.max(rate('paint_min'), metalM * rate('paint_m'))
    const isMin = paint === rate('paint_min') && paint > metalM * rate('paint_m')
    lines.push({
      name: 'Покраска порошковая', qty: isMin ? 1 : r2(metalM), unit: isMin ? 'заказ (минимум)' : 'пог.м металла',
      price: isMin ? paint : rate('paint_m'), total: Math.round(paint),
    })
  }
  if (rate('glazing_glass') > 0)
    lines.push({ name: 'Остекление и сборка', qty: glassCount, unit: 'стекло', price: rate('glazing_glass'), total: Math.round(glassCount * rate('glazing_glass')) })

  const totalCost = lines.reduce((s, l) => s + l.total, 0)
  const weightKg = profileM * W_PROFILE + shtapikM * W_SHTAPIK + glassAreaNetM2 * 10

  return {
    areaM2: r2((W * H) / 1_000_000),
    metalM: r2(metalM),
    glassCount,
    glassAreaM2: r2(glassAreaM2),
    weightKg: Math.round(weightKg * 10) / 10,
    costLines: lines,
    totalCost: Math.round(totalCost),
    spec: [...specParts, p.glassName, p.tempering ? 'закалка' : null, 'покраска (чёрный)'].filter(Boolean).join(' · '),
  }
}
