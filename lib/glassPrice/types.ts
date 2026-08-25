export type RawTextItem = { text: string; x: number; y: number; w?: number }
export type RawPage = { page: number; items: RawTextItem[] }
export type RawCell = { text: string; x: number; end: number }
export type RawGrid = { page: number; rows: RawCell[][] }

export type ParsedItem = {
  section: string
  product: string
  variantCode: string
  thicknessMm: number | null
  sheetFormat: string
  pricePerM2: number | null
  note: string
  sortOrder: number
}

export type ParsedTable = {
  section: string
  columns: string[]
  page: number
  rows: { code: string; thicknessMm: number | null; cells: (number | null)[]; attr: string; note: string; sheetFormat: string }[]
}

export type ParseResult = {
  tables: ParsedTable[]
  items: ParsedItem[]
  warnings: string[]
}

export type MatrixCategory = 'glass' | 'mirror'

export type Mapping = {
  matrix_name: string
  matrix_category: MatrixCategory
  thickness: number          // 0 = правило на все толщины
  section: string
  product: string
  coefficient: number
  rounding: number
  enabled: boolean
}

export type MatrixCostRow = {
  name: string
  category: MatrixCategory
  t4: number | null; t5: number | null; t6: number | null
  t8: number | null; t10: number | null; t12: number | null
}

export type PlanChange = {
  matrix_name: string
  matrix_category: MatrixCategory
  thickness: number
  old_value: number | null
  new_value: number
  section: string
  product: string
  coefficient: number
  price_per_m2: number
}

export type PlanSkip = {
  matrix_name: string
  matrix_category: MatrixCategory
  thickness: number
  reason: 'no_item' | 'no_price' | 'no_matrix_row'
  section: string
  product: string
}

export type ApplyPlan = {
  changes: PlanChange[]
  unchanged: number
  skips: PlanSkip[]
  unmappedProducts: { section: string; product: string }[]
}
