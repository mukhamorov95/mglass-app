export declare const COST_KEYS: readonly ['glass', 'hardware', 'designer', 'measurer', 'installer', 'delivery', 'partners', 'claims', 'tax', 'bonus_manager', 'bonus_ror', 'bonus_rop']
export type CostKey = typeof COST_KEYS[number]
export declare const REQUIRED_COSTS: CostKey[]
export declare const COST_RU: Record<CostKey, string>
export type EditField = CostKey | 'closed'
export declare const EDIT_FIELDS: EditField[]
export type MarginEdit = { value: number; by: string | null; at: string }
export type SaleEdits = Partial<Record<EditField, MarginEdit>>
