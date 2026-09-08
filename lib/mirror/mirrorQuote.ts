// Движок зеркала: геометрия → количества → себестоимость (маршрут Зеркала 2.0).
// Чистая функция без Supabase и React: данные приходят готовыми, наружу уходит
// спецификация строками. Считает КОЛИЧЕСТВА, а не «метры × цена»:
//   • лента — целыми бухтами (5 м), профиль/рассеиватель — целыми хлыстами;
//   • блок питания подбирается с запасом мощности 30% (загрузка ≤ 70%).
// Чего нет в справочнике — попадает в missing[], а не молча в ноль: занижение
// на пустой позиции уже стоило нам денег на душевых.
//
// ТИП ПОДСВЕТКИ — ядро изделия (слова владельца 04.09.2026):
//   • aura   — свечение ЗА зеркалом на стену: лента по тыльному периметру,
//              профиль-рассеиватель НЕ нужен;
//   • front  — свет на лицо через ПЕСКОСТРУЙНУЮ полосу: лента в профиле с
//              рассеивателем + сама песочка;
//   • both   — обе сразу: ДВЕ ленты, суммарная мощность на один блок с запасом,
//              и надбавка за сборку (второй контур).

export type MirrorShape = 'rect' | 'circle' | 'oval'
export type MirrorSides = { top: boolean; bottom: boolean; left: boolean; right: boolean }
export type MirrorControl = 'none' | 'button' | 'sensor'
export type MirrorFrameKind = 'none' | 'vetro' | 'metal' | 'ushape'
export type MirrorLightMode = 'none' | 'aura' | 'front' | 'both'

export type MirrorComponent = {
  id: number
  component_type: string          // led_strip | power_supply | diffuser | frame | button | sensor | wire | connector | dimmer | heating | sandblast | assembly
  name: string
  voltage: number | null
  power_per_meter: number | null
  max_power: number | null
  cost_price: number
  unit: string | null
  pack_length_m: number | null
  sort_order?: number | null      // порядок в справочнике = что берём по умолчанию
}

export type MirrorQuoteInput = {
  width: number                   // мм
  height: number                  // мм
  shape: MirrorShape
  lightMode: MirrorLightMode
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
  contour?: 'aura' | 'front'      // к какому контуру относится строка (у «обеих» видно)
}
export type MirrorMissing = { role: string; label: string; reason: 'нет позиции' | 'нет цены' | 'не хватает мощности' }

export type MirrorQuote = {
  areaM2: number
  perimeterM: number
  lightingM: number               // суммарная длина подсветки по всем контурам
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

// Длина одного контура подсветки — по выбранным сторонам. Старый экран считал по
// всему периметру даже когда свет с одной стороны, и завышал ленту и профиль.
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
//
// Берём ПЕРВУЮ ПО ПОРЯДКУ справочника, а не самую дешёвую: «дешёвая» — правило,
// которое я придумал за владельца, и оно выбирало ленту 5050 за 58 ₽ вместо
// рабочей 2835 за 88 ₽. Что ставить по умолчанию — решает порядок в админке.
const first = (comps: MirrorComponent[], types: string[], voltage?: number) =>
  comps.filter(c => types.includes(c.component_type) && (voltage == null || c.voltage == null || c.voltage === voltage))
       .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.cost_price - b.cost_price)[0] ?? null

// Совместимость со старыми снимками: раньше был флаг lighting:boolean без типа.
export function normalizeLightMode(input: { lightMode?: MirrorLightMode; lighting?: boolean }): MirrorLightMode {
  if (input.lightMode) return input.lightMode
  return input.lighting ? 'aura' : 'none'
}

export function calcMirrorQuote(
  input: MirrorQuoteInput,
  comps: MirrorComponent[],
  frameRates: Record<string, number>,
): MirrorQuote {
  const { areaM2, perimeterM } = mirrorGeometry(input.width, input.height, input.shape)
  const mode = input.lightMode
  const hasAura = mode === 'aura' || mode === 'both'
  const hasFront = mode === 'front' || mode === 'both'
  const contourM = (hasAura || hasFront) ? lightingLength(input.width, input.height, input.shape, input.sides) : 0

  const lines: MirrorLine[] = []
  const missing: MirrorMissing[] = []
  const add = (role: string, label: string, qty: number, unit: string, unitPrice: number, note?: string, contour?: 'aura' | 'front') => {
    if (qty <= 0 || unitPrice <= 0) return
    lines.push({ role, label, qty, unit, unitPrice, total: Math.round(qty * unitPrice), note, contour })
  }

  // Одна лента на контур; у «обеих» два контура одинаковой длины по тем же сторонам.
  let totalWattsNeed = 0
  const strip = (hasAura || hasFront) ? first(comps, ['led_strip'], input.voltage) : null

  const addStrip = (contour: 'aura' | 'front') => {
    if (contourM <= 0) return
    if (!strip) { missing.push({ role: 'led_strip', label: 'Лента', reason: 'нет позиции' }); return }
    const p = packs(contourM, strip.pack_length_m)
    add('led_strip', strip.name, p.qty, p.byPack ? 'бухта' : 'пог.м',
      p.byPack ? strip.cost_price * (strip.pack_length_m as number) : strip.cost_price,
      `${contour === 'aura' ? 'аура' : 'фронт'} · нужно ${contourM} м${p.byPack ? ` → бухта ${strip.pack_length_m} м` : ''}`,
      contour)
    totalWattsNeed += (strip.power_per_meter ?? 0) * contourM
  }

  if (hasAura) {
    // Аура: лента по тыльному периметру, БЕЗ профиля-рассеивателя (свет на стену).
    addStrip('aura')
  }
  if (hasFront) {
    // Фронт: лента в профиле с рассеивателем + пескоструйная полоса.
    addStrip('front')
    const diff = first(comps, ['diffuser'])
    if (!diff) missing.push({ role: 'diffuser', label: 'Профиль с рассеивателем', reason: 'нет позиции' })
    else {
      const p = packs(contourM, diff.pack_length_m)
      add('diffuser', diff.name, p.qty, p.byPack ? 'хлыст' : 'м.п.',
        p.byPack ? diff.cost_price * (diff.pack_length_m as number) : diff.cost_price,
        p.byPack ? `нужно ${contourM} м → хлыст ${diff.pack_length_m} м` : undefined, 'front')
    }
    // Песочка — определяющая позиция фронтальной подсветки. Нет цены → пробел,
    // а не молчаливый ноль: фронт без песочки не бывает.
    const sand = first(comps, ['sandblast', 'песок', 'песочка'])
    if (!sand) missing.push({ role: 'sandblast', label: 'Пескоструйная полоса', reason: 'нет цены' })
    else {
      // Цена за метр полосы (unit пог.м) или за м² — считаем по длине полосы.
      add('sandblast', sand.name, contourM, sand.unit || 'пог.м', sand.cost_price,
        `полоса ${contourM} м`, 'front')
    }
  }

  // Блок питания — на СУММАРНУЮ мощность всех контуров, с запасом. У «обеих» это
  // и есть «усиленный блок»: две ленты складываются, а не берут по блоку на каждую.
  if (hasAura || hasFront) {
    const needW = r2(totalWattsNeed)
    const { psu, targetW, enough } = pickPsu(comps, input.voltage, needW)
    if (!psu) missing.push({ role: 'power_supply', label: 'Блок питания', reason: 'нет позиции' })
    else {
      add('power_supply', psu.name, 1, 'шт', psu.cost_price,
        `${mode === 'both' ? 'две ленты ' : ''}${needW} Вт, с запасом ${Math.round((1 - PSU_LOAD) * 100)}% → нужен ${targetW} Вт`)
      if (!enough) missing.push({ role: 'power_supply', label: `Блок питания на ${targetW} Вт`, reason: 'не хватает мощности' })
    }

    // Управление.
    if (input.control !== 'none') {
      const types = input.control === 'sensor' ? ['sensor', 'сенсор'] : ['button', 'кнопка']
      const ctl = first(comps, types)
      if (!ctl) missing.push({ role: types[0], label: input.control === 'sensor' ? 'Сенсор' : 'Кнопка', reason: 'нет позиции' })
      else add(types[0], ctl.name, 1, 'шт', ctl.cost_price)
    }

    // Провод и коннекторы — НЕ обязательны (в счетах идут с блоком и сенсором).
    const wire = first(comps, ['wire', 'провод'])
    if (wire) {
      const p = packs(Math.max(2, contourM), wire.pack_length_m)
      add('wire', wire.name, p.qty, p.byPack ? 'бухта' : 'м',
        p.byPack ? wire.cost_price * (wire.pack_length_m as number) : wire.cost_price)
    }
    const conn = first(comps, ['connector', 'коннектор'])
    if (conn) add('connector', conn.name, mode === 'both' ? 4 : 2, 'шт', conn.cost_price)

    // Сборка: наклейка ленты, пайка, установка выключателя. У «обеих» — два
    // контура, поэтому qty 2 (надбавка владельца). Позиция необязательна: пока
    // её нет в справочнике, расчёт не блокируем, но как заведут — считается.
    const asm = first(comps, ['assembly', 'сборка'])
    if (asm) add('assembly', asm.name, mode === 'both' ? 2 : 1, asm.unit || 'шт', asm.cost_price,
      mode === 'both' ? 'два контура' : undefined)
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
    for (const [key, label] of [['metal', 'Металл на раму'], ['cutting', 'Резка полос'], ['welding', 'Сварка каркаса'], ['painting', 'Покраска'], ['assembly', 'Сборка в раме']] as const) {
      const v = frameRates[key] ?? 0
      if (v > 0) add('frame_metal', label, 1, 'шт', v)
      else missing.push({ role: 'frame_metal', label, reason: 'нет цены' })
    }
  } else if (input.frame === 'ushape') {
    missing.push({ role: 'frame_ushape', label: 'П-образный профиль', reason: 'нет цены' })
  }

  const hardwareCost = lines.reduce((s, l) => s + l.total, 0)
  const contours = (hasAura ? 1 : 0) + (hasFront ? 1 : 0)
  return {
    areaM2, perimeterM, lightingM: r2(contourM * contours),
    lines, hardwareCost, glassCost: input.glassCost,
    directCost: Math.round(hardwareCost + input.glassCost),
    missing, complete: missing.length === 0,
  }
}
