import { createClient } from './supabase-browser'

export type GlassMatrixRow = {
  name: string
  price_type: 'cost' | 'sale'
  category: 'glass' | 'mirror'
  waste_pct: number | null
  t4: number | null; t5: number | null; t6: number | null
  t8: number | null; t10: number | null
}

export type WasteModifier = {
  id: number
  rule_key: string
  rule_name: string
  percent_add: number
  active: boolean
  applies_to: string   // 'glass' | 'mirror' | 'all'
  description: string | null
  sort_order: number
}

export const MATRIX_MM = [4, 5, 6, 8, 10] as const
export type MatrixMm = typeof MATRIX_MM[number]

export async function loadGlassMatrix(): Promise<GlassMatrixRow[]> {
  const sb = createClient()
  const { data } = await sb.from('glass_price_matrix').select('*').order('sort_order').order('name')
  return (data ?? []) as GlassMatrixRow[]
}

export async function loadWasteModifiers(): Promise<WasteModifier[]> {
  const sb = createClient()
  const { data } = await sb.from('material_waste_modifiers').select('*').eq('active', true).order('sort_order')
  return (data ?? []) as WasteModifier[]
}

export function getMatrixPrice(
  rows: GlassMatrixRow[],
  name: string,
  mm: number,
  priceType: 'cost' | 'sale',
  category: 'glass' | 'mirror',
): number | null {
  const row = rows.find(r => r.name === name && r.price_type === priceType && r.category === category)
  if (!row) return null
  return (row as Record<string, unknown>)[`t${mm}`] as number | null
}

export function getWastePct(rows: GlassMatrixRow[], name: string, category: 'glass' | 'mirror'): number {
  const row = rows.find(r => r.name === name && r.price_type === 'cost' && r.category === category)
  return row?.waste_pct ?? 0
}

export function getMatrixNames(rows: GlassMatrixRow[], priceType: 'cost' | 'sale', category: 'glass' | 'mirror'): string[] {
  return rows
    .filter(r => r.price_type === priceType && r.category === category)
    .map(r => r.name)
}

export function getAvailableMm(
  rows: GlassMatrixRow[],
  name: string,
  priceType: 'cost' | 'sale',
  category: 'glass' | 'mirror',
): MatrixMm[] {
  const row = rows.find(r => r.name === name && r.price_type === priceType && r.category === category)
  if (!row) return []
  return MATRIX_MM.filter(mm => (row as Record<string, unknown>)[`t${mm}`] != null)
}

// Returns the shape-based waste modifier percent for a given shape
// rule_key maps to mirror shapes from mirrorCalculator
export function getShapeModifier(
  modifiers: WasteModifier[],
  ruleKey: string,
): number {
  return modifiers.find(m => m.rule_key === ruleKey && m.active)?.percent_add ?? 0
}
