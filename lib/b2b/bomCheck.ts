import type { B2BMaterial, B2BService } from '../types'
import { TEMPERING_COST, type B2BOrderItem, type FacetPrice } from '../b2bCalculator'

// Проверка спецификации до отправки просчёта: где позиция не сходится со справочником
// (нет себестоимости) — там маржа считается от нуля, и изделие может уйти клиенту
// дешевле, чем нам обошлось. Ничего не блокируем: показываем, что именно не сопоставлено.

export type BomIssueCode =
  | 'material_inactive'
  | 'material_no_cost'
  | 'tempering_no_cost'
  | 'service_no_cost'
  | 'facet_no_price'
  | 'triplex_no_price'
  | 'supplier_price_unmapped'

export type BomIssue = {
  itemIndex: number
  code: BomIssueCode
  severity: 'block' | 'warn'
  subject: string     // что именно не найдено: материал/услуга/фацет
  detail: string      // человеческая формулировка для плашки
}

export type BomCheckItem = {
  material: Pick<B2BMaterial, 'name' | 'category' | 'thickness' | 'cost_price' | 'active'>
  hasTempering?: boolean
  hasFacet?: boolean
  facetTypeMm?: number | null
  hasTriplex?: boolean
  triplexPrice?: { salePerM2: number; costPerM2: number } | null
  services?: Pick<B2BService, 'name' | 'type' | 'value' | 'cost_price'>[]
}

export type BomCheckRef = {
  facetPrices: FacetPrice[]
  // ключи материалов, привязанных к прайсу поставщика: `${name}|${'glass'|'mirror'}`
  pricedMaterials?: Set<string>
}

// Категория b2b_materials → категория справочника «Стекло» (glass_price_matrix)
export function matrixCategoryOf(category: string): 'glass' | 'mirror' {
  return category.trim().toLowerCase() === 'зеркало' ? 'mirror' : 'glass'
}

export function materialPriceKey(name: string, category: string): string {
  return `${name.trim()}|${matrixCategoryOf(category)}`
}

// Надбавки за габариты приходят синтетическими percent-услугами — у них себестоимости
// нет by design, поэтому в проверку они не идут.
const COSTED_SERVICE_TYPES = new Set(['per_m2', 'fixed', 'film'])

export function checkQuoteBom(items: BomCheckItem[], ref: BomCheckRef): BomIssue[] {
  const issues: BomIssue[] = []

  items.forEach((item, itemIndex) => {
    const mat = item.material
    const title = `${mat.name} ${mat.thickness} мм`

    if (mat.active === false) {
      issues.push({
        itemIndex, code: 'material_inactive', severity: 'block', subject: title,
        detail: `${title} — материал выключен в справочнике: цена и себестоимость могут быть устаревшими`,
      })
    }

    if (!(Number(mat.cost_price) > 0)) {
      issues.push({
        itemIndex, code: 'material_no_cost', severity: 'block', subject: title,
        detail: `${title} — нет себестоимости в справочнике: маржа считается от нуля`,
      })
    }

    if (item.hasTempering && !(TEMPERING_COST[mat.thickness] > 0)) {
      issues.push({
        itemIndex, code: 'tempering_no_cost', severity: 'block', subject: `закалка ${mat.thickness} мм`,
        detail: `Закалка ${mat.thickness} мм — нет тарифа: закалка посчитана бесплатно`,
      })
    }

    if (item.hasFacet) {
      const type = item.facetTypeMm ?? null
      const facet = type == null ? undefined : ref.facetPrices.find(f => f.type_mm === type && f.active !== false)
      if (!facet || !(Number(facet.cost_price) > 0)) {
        issues.push({
          itemIndex, code: 'facet_no_price', severity: 'block',
          subject: type == null ? 'фацет' : `фацет ${type} мм`,
          detail: type == null
            ? 'Фацет включён, но тип не выбран — цены в справочнике нет'
            : `Фацет ${type} мм — нет цены в справочнике`,
        })
      }
    }

    if (item.hasTriplex && !(Number(item.triplexPrice?.costPerM2) > 0)) {
      issues.push({
        itemIndex, code: 'triplex_no_price', severity: 'block', subject: 'триплексация',
        detail: 'Триплекс включён, но себестоимости триплексации в справочнике услуг нет',
      })
    }

    for (const svc of item.services ?? []) {
      if (!COSTED_SERVICE_TYPES.has(svc.type)) continue
      if (!(Number(svc.value) > 0)) continue
      if (Number(svc.cost_price) > 0) continue
      issues.push({
        itemIndex, code: 'service_no_cost', severity: 'block', subject: svc.name,
        detail: `Услуга «${svc.name}» продаётся, но себестоимости в справочнике нет`,
      })
    }

    if (ref.pricedMaterials && !ref.pricedMaterials.has(materialPriceKey(mat.name, mat.category))) {
      issues.push({
        itemIndex, code: 'supplier_price_unmapped', severity: 'warn', subject: title,
        detail: `${title} — не привязан к прайсу поставщика: при следующем прайсе себестоимость не обновится`,
      })
    }
  })

  return issues
}

// Быстрая проверка уже сохранённого просчёта — без справочников, по самим цифрам позиции.
// Нужна там, где справочник не загружен: список просчётов, карточка заказа. Себестоимость
// в сохранённых позициях лежит то с НДС, то без — берём любую доступную.
export type SavedItemLike = Partial<Pick<B2BOrderItem, 'materialName' | 'thickness' | 'costWithVat' | 'costExVat' | 'saleIncVat'>>

export function checkSavedItems(items: SavedItemLike[]): BomIssue[] {
  return items.flatMap((it, itemIndex) => {
    const cost = Number(it.costWithVat ?? 0) || Number(it.costExVat ?? 0)
    if (cost > 0 || !(Number(it.saleIncVat) > 0)) return []
    const title = `${it.materialName ?? 'Позиция'}${it.thickness ? ` ${it.thickness} мм` : ''}`
    return [{
      itemIndex,
      code: 'material_no_cost' as const,
      severity: 'block' as const,
      subject: title,
      detail: `${title} — себестоимость нулевая: позиция не сопоставлена со справочником`,
    }]
  })
}

export function summarizeIssues(issues: BomIssue[]): { blocking: number; warnings: number; positions: number } {
  const blocking = issues.filter(i => i.severity === 'block').length
  return {
    blocking,
    warnings: issues.length - blocking,
    positions: new Set(issues.map(i => i.itemIndex)).size,
  }
}
