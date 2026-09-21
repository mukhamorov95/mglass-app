import type { PieceGroup, MaterialCuttingResult, SheetFormat } from '@/lib/cuttingOptimizer'

// Материал под заказы: три состояния для закупщика поверх уже существующего
// notes.material_status (9 значений в /b2b-orders + 2 цеховых). Четвёртый флаг
// не заводим: цех, менеджер и закупщик должны видеть одно и то же поле.

export type SupplyState = 'not_ordered' | 'ordered' | 'in_stock'

const r2 = (n: number) => Math.round(n * 100) / 100

const ORDERED = new Set(['ordered', 'invoice_received', 'paid', 'shipped'])
const IN_STOCK = new Set(['received', 'ready'])

export const SUPPLY_LABEL: Record<SupplyState, string> = {
  not_ordered: 'Не заказан',
  ordered: 'Заказан',
  in_stock: 'Есть',
}

export function supplyState(materialStatus: unknown): SupplyState {
  const s = typeof materialStatus === 'string' ? materialStatus : ''
  if (ORDERED.has(s)) return 'ordered'
  if (IN_STOCK.has(s)) return 'in_stock'
  return 'not_ordered'
}

// Что записать в заказ при выборе состояния. «Заказан» и «есть» ставят
// stages.material_ordered (его читает раскрой и прячет заказ из «что кроить на
// закупку»); «не заказан» снимает флаг — иначе заказ навсегда выпал бы из расчёта.
// Уже стоящую дату не перезаписываем: она говорит, когда материал заказали.
export function writeFor(
  state: SupplyState,
  current: { materialStatus?: unknown; materialOrdered?: string | null },
  today: string,
  opts: { fromPurchase?: boolean } = {},
): { materialStatus: string; stages: Record<string, string | null> } {
  if (state === 'not_ordered') {
    // «Нет (цех)» — тоже «не заказан», но сообщение цеха о нехватке не стираем.
    const keep = current.materialStatus === 'needed' ? 'needed' : 'need_to_buy'
    return { materialStatus: keep, stages: { material_ordered: null } }
  }
  const status = state === 'ordered'
    // Уже двигающийся по закупке статус (счёт, оплачен, в пути) не откатываем в «заказан».
    ? (ORDERED.has(String(current.materialStatus)) ? String(current.materialStatus) : 'ordered')
    // Пришёл по заказу поставщику — «принят»; отметили, что лежит на складе, — «есть».
    : (opts.fromPurchase ? 'received' : 'ready')
  return { materialStatus: status, stages: { material_ordered: current.materialOrdered || today } }
}

// «Граница»: последний по порядку добавления заказ, на который материал заказан
// или есть. Всё после неё без отметки — то, что закупщику ещё предстоит заказать.
// Заказы без отметки ДО границы — пропуски: их легко потерять, поэтому отдельно.
export function frontier<T extends { id: number; state: SupplyState }>(queueAsc: T[]) {
  let lastIdx = -1
  queueAsc.forEach((o, i) => { if (o.state !== 'not_ordered') lastIdx = i })
  const last = lastIdx >= 0 ? queueAsc[lastIdx] : null
  const gaps = queueAsc.slice(0, Math.max(0, lastIdx)).filter(o => o.state === 'not_ordered').map(o => o.id)
  const after = queueAsc.slice(lastIdx + 1).filter(o => o.state === 'not_ordered').map(o => o.id)
  return { lastId: last?.id ?? null, gaps, after }
}

// ─── Что заказать ───────────────────────────────────────────────────────────

export type OrderItem = {
  materialName?: string; thickness?: number; category?: string
  width?: number; height?: number; quantity?: number
  hasTriplex?: boolean; triplexLayers?: number
  triplexGlasses?: { materialName?: string; thickness?: number }[]
}
export type PurchaseMaterial = {
  id: number; name: string; thickness: number | string; category?: string | null
  cost_price: number | string | null
  sheet_width: number | null; sheet_height: number | null
  pattern_direction: string | null
}
export type SheetVariant = { material_id: number; sheet_width: number; sheet_height: number; active?: boolean | null }

export type UnknownMaterial = { material: string; thickness: number; pieces: number; m2: number; orders: number[] }

// «Серебро» + 4 → «Серебро 4 мм», но «Зеркало … 4 мм» + 4 → без повтора толщины:
// у изделий она уже вписана в название.
export function withThickness(name: string, thk: number | string | null | undefined): string {
  const t = Number(thk) || 0
  const n = (name ?? '').trim()
  if (!t) return n
  const tail = new RegExp(`(^|\\s)${String(t).replace('.', '[.,]')}\\s*мм\\s*$`, 'i')
  return tail.test(n) ? n : `${n} ${t} мм`.trim()
}

const keyOf = (name: string, thk: number) => `${name.trim().toLowerCase()}|${Number(thk) || 0}`

// «Осветлённое» и «осветленное» — одно и то же: в заказах пишут и так и так.
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

export type ResolvedMaterial = { from: string; to: string; thickness: number; pieces: number; m2: number; orders: number[] }

// Позиция-изделие называется «Зеркало с подсветкой Осветлённое 4 мм» — это не
// материал из справочника, а изделие, в котором стекло названо внутри. Достаём
// материал по вхождению названия: у зеркал ищем только среди зеркал, иначе
// «Осветлённое» (зеркало, 1 180 ₽/м²) спуталось бы с «Осветлённым CrystalVision»
// (стекло). Угадывание не прячем — экран показывает, что во что распозналось.
export function resolveMaterial(
  itemName: string,
  thickness: number,
  materials: PurchaseMaterial[],
): PurchaseMaterial | null {
  const hay = norm(itemName)
  if (!hay) return null
  const thk = Number(thickness) || 0
  const isMirror = /зеркал/.test(hay)
  const isGlass = !isMirror && /стекл/.test(hay)

  const fits = materials.filter(m => {
    if ((Number(m.thickness) || 0) !== thk) return false
    const name = norm(m.name)
    if (!name || name === hay) return false
    // Целым словом: «серебро» не должно ловиться внутри «серебросодержащий».
    if (!new RegExp(`(^|[^а-яa-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^а-яa-z0-9]|$)`).test(hay)) return false
    if (isMirror) return m.category === 'зеркало'
    if (isGlass) return m.category !== 'зеркало'
    return true
  })
  if (!fits.length) return null
  // Самое длинное совпадение — самое точное: «Осветлённое CrystalVision» важнее «Осветлённого».
  return fits.sort((a, b) => norm(b.name).length - norm(a.name).length || a.name.localeCompare(b.name))[0]
}

// Позиции заказов → группы деталей под раскрой. Группа — материал + толщина:
// одно и то же стекло режется с одного листа, какой бы категорией его ни
// подписали. Триплекс даёт деталь на каждый слой. Материал, которого нет в
// справочнике, не кроим на лист «по умолчанию» — он уходит в unknown.
export function buildPurchaseGroups(
  orders: { id: number; client: string; items: OrderItem[] }[],
  materials: PurchaseMaterial[],
  variants: SheetVariant[],
): { groups: Map<string, PieceGroup>; unknown: UnknownMaterial[]; materialByKey: Map<string, PurchaseMaterial>; extraLayerM2: number; resolved: ResolvedMaterial[] } {
  const materialByKey = new Map<string, PurchaseMaterial>()
  for (const m of materials) materialByKey.set(keyOf(m.name, Number(m.thickness)), m)
  const formatsOf = new Map<number, SheetFormat[]>()
  for (const v of variants) {
    if (v.active === false || !(v.sheet_width > 0) || !(v.sheet_height > 0)) continue
    const list = formatsOf.get(v.material_id) ?? []
    list.push({ width: v.sheet_width, height: v.sheet_height })
    formatsOf.set(v.material_id, list)
  }

  const groups = new Map<string, PieceGroup>()
  const unknown = new Map<string, UnknownMaterial>()
  // Площадь вторых и третьих слоёв триплекса: стекла под них покупать надо, а в
  // площади позиции их нет. Без этой цифры итог «что заказать» не сходится с
  // суммой позиций заказов.
  let extraLayerM2 = 0
  const resolved = new Map<string, ResolvedMaterial>()

  for (const o of orders) {
    for (const it of o.items) {
      const w = Number(it.width) || 0, h = Number(it.height) || 0
      if (!(w > 0) || !(h > 0)) continue
      const qty = Math.max(1, Number(it.quantity) || 1)
      const layers: { name: string; thk: number }[] = [{ name: it.materialName ?? '', thk: Number(it.thickness) || 0 }]
      if (it.hasTriplex) {
        const extras = it.triplexGlasses?.length
          ? it.triplexGlasses
          : Array.from({ length: (it.triplexLayers === 3 ? 3 : 2) - 1 }, () => ({ materialName: it.materialName, thickness: it.thickness }))
        for (const g of extras) layers.push({ name: g.materialName ?? it.materialName ?? '', thk: Number(g.thickness ?? it.thickness) || 0 })
      }

      layers.forEach((layer, li) => { if (li > 0) extraLayerM2 += (w * h * qty) / 1e6 })
      for (const layer of layers) {
        const exactKey = keyOf(layer.name, layer.thk)
        let mat = materialByKey.get(exactKey)
        let key = exactKey
        if (!mat) {
          // Изделие: материал назван внутри названия позиции.
          const guess = resolveMaterial(layer.name, layer.thk, materials)
          if (guess) {
            mat = guess
            key = keyOf(guess.name, Number(guess.thickness) || 0)
            const rk = `${exactKey}→${key}`
            const r = resolved.get(rk) ?? {
              from: layer.name, to: guess.name, thickness: Number(guess.thickness) || 0, pieces: 0, m2: 0, orders: [],
            }
            r.pieces += qty
            r.m2 = r2(r.m2 + (w * h * qty) / 1e6)
            if (!r.orders.includes(o.id)) r.orders.push(o.id)
            resolved.set(rk, r)
          }
        }
        if (!mat) {
          const u = unknown.get(key) ?? { material: layer.name || 'Материал не указан', thickness: layer.thk, pieces: 0, m2: 0, orders: [] }
          u.pieces += qty
          u.m2 += (w * h * qty) / 1e6
          if (!u.orders.includes(o.id)) u.orders.push(o.id)
          unknown.set(key, u)
          continue
        }
        let g = groups.get(key)
        if (!g) {
          const thk = Number(mat.thickness) || 0
          g = {
            pieces: [],
            materialLabel: withThickness(mat.name, thk),
            category: '',
            sheetWidth: mat.sheet_width ?? 3210,
            sheetHeight: mat.sheet_height ?? 2250,
            patternDirection: (mat.pattern_direction ?? 'none') as PieceGroup['patternDirection'],
            sheetFormats: formatsOf.get(mat.id),
          }
          groups.set(key, g)
        }
        for (let i = 0; i < qty; i++) {
          g.pieces.push({
            id: `${o.id}-${key}-${g.pieces.length}`,
            width: w, height: h, label: `${w}×${h}`,
            orderId: o.id, orderClientName: o.client, materialKey: key, canRotate: true,
          })
        }
      }
    }
  }
  return {
    groups, unknown: [...unknown.values()].sort((a, b) => b.m2 - a.m2), materialByKey,
    extraLayerM2: r2(extraLayerM2), resolved: [...resolved.values()].sort((a, b) => b.m2 - a.m2),
  }
}

export type NeedRow = {
  key: string
  label: string
  materialName: string   // как в справочнике — для заказа поставщику
  thickness: number
  pieces: number
  orders: number[]
  netM2: number          // чистая площадь деталей
  sheets: number
  sheetWidth: number
  sheetHeight: number
  sheetsM2: number       // площадь закупаемых листов
  efficiency: number     // % использования листов
  pricePerM2: number
  cost: number           // листы × площадь листа × цена за м²
  unplaced: number       // деталей больше листа — их раскрой не разложил
}

// Результат раскроя → строки «что заказать». Стоимость — за целые листы:
// покупаем листами, а не метрами, поэтому считаем по площади листов.
export function summarizeNeeds(results: MaterialCuttingResult[], materialByKey: Map<string, PurchaseMaterial>): NeedRow[] {
  return results.map(r => {
    const mat = materialByKey.get(r.materialKey)
    const price = Number(mat?.cost_price) || 0
    const sheetM2 = (r.sheetWidth * r.sheetHeight) / 1e6
    const orders = [...new Set(r.sheets.flatMap(s => s.pieces.map(p => p.orderId)).concat(r.unplacedPieces.map(p => p.orderId)))]
    const net = r.sheets.reduce((s, sh) => s + sh.usedArea, 0) + r.unplacedPieces.reduce((s, p) => s + p.width * p.height, 0)
    return {
      key: r.materialKey,
      label: r.materialLabel,
      materialName: mat?.name ?? r.materialLabel,
      thickness: Number(mat?.thickness) || 0,
      pieces: r.totalPieces,
      orders: orders.sort((a, b) => a - b),
      netM2: r2(net / 1e6),
      sheets: r.sheetsNeeded,
      sheetWidth: r.sheetWidth,
      sheetHeight: r.sheetHeight,
      sheetsM2: r2(r.sheetsNeeded * sheetM2),
      efficiency: Math.round(r.avgEfficiency),
      pricePerM2: price,
      cost: Math.round(r.sheetsNeeded * sheetM2 * price),
      unplaced: r.unplacedCount,
    }
  }).sort((a, b) => b.cost - a.cost || b.netM2 - a.netM2)
}

// ─── Заказ поставщику ───────────────────────────────────────────────────────

// Позиции заказа поставщику в том виде, в каком их читает канбан закупок
// (/admin/procurement) и заводит «Заказы B2B»: материал, формат, листы, м²,
// оценка. Не распознанное — строкой с unmatched, чтобы не потерялось в счёте.
export function supplierOrderItems(
  needs: NeedRow[],
  unknown: UnknownMaterial[],
  numberOf: (orderId: number) => string,
) {
  const known = needs.map(r => ({
    material_name: r.materialName,
    thickness: r.thickness || null,
    sheet_width: r.sheetWidth,
    sheet_height: r.sheetHeight,
    area_m2: r.netM2,
    required_area_m2: r.sheetsM2,
    sheets_count: r.sheets,
    estimated_cost: r.cost,
    order_ids: r.orders,
    order_refs: r.orders.map(numberOf),
    unmatched: false,
    sheet_format_source: 'purchasing_nesting',
  }))
  const unmatched = unknown.map(u => ({
    material_name: withThickness(u.material, u.thickness),
    thickness: u.thickness || null,
    sheet_width: null,
    sheet_height: null,
    area_m2: r2(u.m2),
    required_area_m2: null,
    sheets_count: null,
    estimated_cost: null,
    order_ids: u.orders,
    order_refs: u.orders.map(numberOf),
    unmatched: true,
    sheet_format_source: 'purchasing_nesting',
  }))
  return [...known, ...unmatched]
}

// Из заказа поставщику → какие заказы отметить. Заказ, на который материал уже
// заказан или есть, повторно не заказываем — иначе он попал бы в два счёта.
export function splitForSupplierOrder<T extends { id: number; state: SupplyState; cut: boolean }>(orders: T[]) {
  const take = orders.filter(o => !o.cut && o.state === 'not_ordered')
  const skipped = orders.filter(o => o.cut || o.state !== 'not_ordered').map(o => ({
    id: o.id, reason: o.cut ? 'уже нарезан' : o.state === 'ordered' ? 'уже заказан' : 'материал есть',
  }))
  return { take, skipped }
}
