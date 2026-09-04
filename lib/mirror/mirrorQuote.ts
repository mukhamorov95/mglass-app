// Движок зеркала: геометрия → количества → себестоимость (маршрут З3–З5).
// Чистая функция без Supabase и React: данные приходят готовыми, наружу уходит
// спецификация строками. Считает КОЛИЧЕСТВА, а не «метры × цена»:
//   • лента — целыми бухтами (5 м), профиль и рассеиватель — целыми хлыстами (6 м);
//   • блок питания подбирается с запасом мощности 30% (загрузка ≤ 70%).
// Чего нет в справочнике — попадает в missing[], а не молча в ноль: занижение
// на пустой позиции уже стоило нам денег на душевых.

export type MirrorShape = 'rect' | 'circle' | 'oval'
export type MirrorSides = { top: boolean; bottom: boolean; left: boolean; right: boolean }
export type MirrorControl = 'none' | 'button' | 'sensor'
export type MirrorFrameKind = 'none' | 'vetro' | 'metal' | 'ushape'

export type MirrorComponent = {
  id: number
  component_type: string          // led_strip | power_supply | diffuser | frame | button | sensor | wire | connector | dimmer
  name: string
  voltage: number | null
  power_per_meter: number | null
  max_power: number | null
  cost_price: number
  unit: string | null
  pack_length_m: number | null
}

export type MirrorQuoteInput = {
  width: number                   // мм
  height: number                  // мм
  shape: MirrorShape
  lighting: boolean
  sides: MirrorSides
  voltage: 12 | 24
  control: MirrorControl
  frame: MirrorFrameKind
  glassCost: number               // зеркало — из B2B-калькулятора, считает роут
}

export type MirrorLine = {
  role: string
  label: string
  qty: number
  unit: string
  unitPrice: number
  total: number
  note?: string
}
export type MirrorMissing = { role: string; label: string; reason: 'нет позиции' | 'нет цены' | 'не хватает мощности' }

export type MirrorQuote = {
  areaM2: number
  perimeterM: number
  lightingM: number
  lines: MirrorLine[]
  hardwareCost: number
  glassCost: number
  directCost: number
  missing: MirrorMissing[]
  complete: boolean
}

// Запас мощности блока питания: лента грузит его максимум на 70% (владелец: 30–40%).
export const PSU_LOAD = 0.7
const r2 = (n: number) => Math.round(n * 100) / 100

export function mirrorGeometry(width: number, height: number, shape: MirrorShape) {
  const w = Math.max(0, width) / 1000, h = Math.max(0, height) / 1000
  if (shape === 'circle') {
    const r = Math.min(w, h) / 2
    return { areaM2: r2(Math.PI * r * r), perimeterM: r2(2 * Math.PI * r) }
  }
  if (shape === 'oval') {
    const a = w / 2, b = h / 2
    // Периметр эллипса по Рамануджану — та же формула, что в старом движке.
    const per = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
    return { areaM2: r2(Math.PI * a * b), perimeterM: r2(per) }
  }
  return { areaM2: r2(w * h), perimeterM: r2(2 * (w + h)) }
}

// Длина подсветки — только по выбранным сторонам. Старый экран считал по всему
// периметру даже когда свет с одной стороны, и завышал ленту, профиль и рассеиватель.
export function lightingLength(width: number, height: number, shape: MirrorShape, sides: MirrorSides): number {
  const g = mirrorGeometry(width, height, shape)
  if (shape !== 'rect') {
    const n = [sides.top, sides.bottom, sides.left, sides.right].filter(Boolean).length
    return n >= 4 ? g.perimeterM : r2(g.perimeterM * (n / 4))   // дуга по долям контура
  }
  const w = width / 1000, h = height / 1000
  return r2((sides.top ? w : 0) + (sides.bottom ? w : 0) + (sides.left ? h : 0) + (sides.right ? h : 0))
}

// Сколько целых упаковок нужно на длину. Нет длины упаковки — считаем погонно.
export function packs(lengthM: number, packLengthM: number | null): { qty: number; byPack: boolean } {
  if (!packLengthM || packLengthM <= 0) return { qty: r2(lengthM), byPack: false }
  return { qty: Math.max(1, Math.ceil(lengthM / packLengthM)), byPack: true }
}

// Блок питания: нужная мощность с запасом, дальше самый слабый подходящий.
export function pickPsu(comps: MirrorComponent[], voltage: number, needW: number) {
  const target = needW / PSU_LOAD
  const fit = comps
    .filter(c => c.component_type === 'power_supply' && (c.voltage ?? voltage) === voltage && (c.max_power ?? 0) > 0)
    .sort((a, b) => (a.max_power ?? 0) - (b.max_power ?? 0))
  const ok = fit.find(c => (c.max_power ?? 0) >= target)
  return { psu: ok ?? fit[fit.length - 1] ?? null, targetW: r2(target), enough: !!ok }
}

// Вид позиции ищем по нескольким кодам: в справочнике уже жили русские вкладки
// («кнопка»), а новые заведены латиницей — принимаем оба, чтобы не терять позиции.
const first = (comps: MirrorComponent[], types: string[], voltage?: number) =>
  comps.filter(c => types.includes(c.component_type) && (voltage == null || c.voltage == null || c.voltage === voltage))
       .sort((a, b) => a.cost_price - b.cost_price)[0] ?? null

export function calcMirrorQuote(
  input: MirrorQuoteInput,
  comps: MirrorComponent[],
  frameRates: Record<string, number>,
): MirrorQuote {
  const { areaM2, perimeterM } = mirrorGeometry(input.width, input.height, input.shape)
  const lightingM = input.lighting ? lightingLength(input.width, input.height, input.shape, input.sides) : 0
  const lines: MirrorLine[] = []
  const missing: MirrorMissing[] = []

  const add = (role: string, label: string, qty: number, unit: string, unitPrice: number, note?: string) => {
    if (qty <= 0 || unitPrice <= 0) return
    lines.push({ role, label, qty, unit, unitPrice, total: Math.round(qty * unitPrice), note })
  }

  if (input.lighting && lightingM > 0) {
    // Лента — целыми бухтами.
    const strip = first(comps, ['led_strip'], input.voltage)
    if (!strip) missing.push({ role: 'led_strip', label: 'Лента', reason: 'нет позиции' })
    else {
      const p = packs(lightingM, strip.pack_length_m)
      add('led_strip', strip.name, p.qty, p.byPack ? 'бухта' : 'пог.м',
        p.byPack ? strip.cost_price * (strip.pack_length_m as number) : strip.cost_price,
        p.byPack ? `нужно ${lightingM} м → бухта ${strip.pack_length_m} м` : undefined)
    }

    // Профиль с рассеивателем — целыми хлыстами.
    const diff = first(comps, ['diffuser'])
    if (!diff) missing.push({ role: 'diffuser', label: 'Профиль с рассеивателем', reason: 'нет позиции' })
    else {
      const p = packs(lightingM, diff.pack_length_m)
      add('diffuser', diff.name, p.qty, p.byPack ? 'хлыст' : 'м.п.',
        p.byPack ? diff.cost_price * (diff.pack_length_m as number) : diff.cost_price,
        p.byPack ? `нужно ${lightingM} м → хлыст ${diff.pack_length_m} м` : undefined)
    }

    // Блок питания — по мощности ленты с запасом.
    const wPerM = strip?.power_per_meter ?? 0
    const needW = r2(wPerM * lightingM)
    const { psu, targetW, enough } = pickPsu(comps, input.voltage, needW)
    if (!psu) missing.push({ role: 'power_supply', label: 'Блок питания', reason: 'нет позиции' })
    else {
      add('power_supply', psu.name, 1, 'шт', psu.cost_price,
        `лента ${needW} Вт, с запасом ${Math.round((1 - PSU_LOAD) * 100)}% → нужен ${targetW} Вт`)
      if (!enough) missing.push({ role: 'power_supply', label: `Блок питания на ${targetW} Вт`, reason: 'не хватает мощности' })
    }

    // Управление и провод — отдельными позициями справочника (решение владельца).
    if (input.control !== 'none') {
      const types = input.control === 'sensor' ? ['sensor', 'сенсор'] : ['button', 'кнопка']
      const ctl = first(comps, types)
      if (!ctl) missing.push({ role: types[0], label: input.control === 'sensor' ? 'Сенсор' : 'Кнопка', reason: 'нет позиции' })
      else add(types[0], ctl.name, 1, 'шт', ctl.cost_price)
    }
    const wire = first(comps, ['wire', 'провод'])
    if (wire) {
      const p = packs(Math.max(2, lightingM), wire.pack_length_m)
      add('wire', wire.name, p.qty, p.byPack ? 'бухта' : 'м',
        p.byPack ? wire.cost_price * (wire.pack_length_m as number) : wire.cost_price)
    } else missing.push({ role: 'wire', label: 'Провод', reason: 'нет позиции' })
    const conn = first(comps, ['connector', 'коннектор'])
    if (conn) add('connector', conn.name, 2, 'шт', conn.cost_price)
  }

  // Рамка.
  if (input.frame === 'vetro') {
    const fr = first(comps, ['frame'])
    if (!fr) missing.push({ role: 'frame', label: 'Профиль рамки', reason: 'нет позиции' })
    else {
      const p = packs(perimeterM, fr.pack_length_m)
      add('frame', fr.name, p.qty, p.byPack ? 'хлыст' : 'м.п.',
        p.byPack ? fr.cost_price * (fr.pack_length_m as number) : fr.cost_price,
        p.byPack ? `периметр ${perimeterM} м → хлыст ${fr.pack_length_m} м` : undefined)
    }
  } else if (input.frame === 'metal') {
    // Сварная металлическая рама — плоские ставки владельца (mirror_frame_rates).
    for (const [key, label] of [['metal', 'Металл на раму'], ['cutting', 'Резка полос'], ['welding', 'Сварка каркаса'], ['painting', 'Покраска'], ['assembly', 'Сборка в раме']] as const) {
      const v = frameRates[key] ?? 0
      if (v > 0) add('frame_metal', label, 1, 'шт', v)
      else missing.push({ role: 'frame_metal', label, reason: 'нет цены' })
    }
  } else if (input.frame === 'ushape') {
    missing.push({ role: 'frame_ushape', label: 'П-образный профиль', reason: 'нет цены' })
  }

  const hardwareCost = lines.reduce((s, l) => s + l.total, 0)
  return {
    areaM2, perimeterM, lightingM,
    lines, hardwareCost, glassCost: input.glassCost,
    directCost: Math.round(hardwareCost + input.glassCost),
    missing, complete: missing.length === 0,
  }
}
