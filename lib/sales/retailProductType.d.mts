export type RetailProductType = 'shower' | 'mirror' | 'loft' | 'partition' | 'railing' | 'door' | 'welded' | 'other'
export declare const RETAIL_PRODUCT_TYPES: RetailProductType[]
export declare const RETAIL_PRODUCT_LABELS: Record<RetailProductType, string>
export declare const AMO_FIELD_ORDER_NO: number
export declare const AMO_FIELD_PRODUCT_TYPE: number
export declare const AMO_FIELD_PRODUCT_OLD: number

export type AmoLeadLike = {
  id: number
  name?: string | null
  custom_fields_values?: { field_id?: number; field_name?: string; values?: { value?: unknown }[] }[] | null
}
export type ProductSource = 'calculation' | 'deal' | 'amo_field' | 'amo_name' | 'text'
export type AmoTypes = { types: RetailProductType[]; source: 'amo_field' | 'amo_name' | null; leadIds: number[]; ambiguous?: boolean }
export type CalcLike = { product_type?: string | null; input_data?: { cart?: { title?: unknown }[] } & Record<string, unknown> | null }

export declare function classifyProductText(text: string | null | undefined): { types: RetailProductType[]; ambiguous: boolean }
export declare function typesFromAmoEnums(values: string[] | null | undefined): RetailProductType[]
export declare function typesFromCalculation(calc: CalcLike | null | undefined): RetailProductType[]
export declare function typesFromKind(kind: string | null | undefined): RetailProductType[]
export declare function formatProductTypes(types: RetailProductType[] | null | undefined): string | null
export declare function parseProductTypes(value: string | null | undefined): RetailProductType[]
export declare function normOrderNo(s: string | null | undefined): string
export declare function leadMatchesOrder(lead: AmoLeadLike, orderNo: string): boolean
export declare function typesFromAmoLeads(leads: AmoLeadLike[] | null | undefined, orderNo: string): AmoTypes
export declare function pickRetailProductType(input?: {
  calculation?: CalcLike | null
  dealKinds?: (string | null)[] | null
  amo?: AmoTypes | null
  text?: string | null
}): { value: string | null; source: ProductSource | null }
export type AmoGet = (path: string, params: Record<string, string>) => Promise<unknown>
export declare function amoProductTypes(orderNos: string[], get: AmoGet): Promise<Map<string, AmoTypes>>
