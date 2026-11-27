import { createServiceClient } from '../supabase-service'
import { loadB2BRates, ratesMissingNote } from '../b2b/rates'
import type { B2BMaterial } from '../types'
import { labQuote, type LabQuote } from '../economics/lab/quote'
import { legacyModel, type Legacy } from '../economics/lab/compare'
import type { LabProject } from '../economics/lab/project'
import { loadReferences, type RefLoad } from './store'

// Один расчёт проекта лаборатории: справочники из базы, материалы и ставки — из действующих
// справочников в режиме чтения. Действующий калькулятор вызывается как есть, его ставки и цены
// не меняются: сравнение двух моделей в этом и состоит.
export type LabCompute = {
  quote: LabQuote | null
  legacy: Legacy | null
  refs: RefLoad
  materials: { id: number; name: string; thickness: number; category: string }[]
  notes: string[]
}

export async function computeQuote(project: LabProject): Promise<LabCompute> {
  const refs = await loadReferences()
  const notes = [...refs.problems]
  const sb = createServiceClient()
  const [{ data: matRows }, ratesLoad] = await Promise.all([
    sb.from('b2b_materials').select('*').eq('active', true).order('category').order('thickness'),
    loadB2BRates(sb),
  ])
  const materials = (matRows ?? []) as B2BMaterial[]
  const rateNote = ratesMissingNote(ratesLoad.missing)
  if (rateNote) notes.push(rateNote)

  const withLabels: LabProject = {
    ...project,
    positions: project.positions.map(p => ({
      ...p,
      materialLabel: materials.find(m => m.id === p.materialId)?.name ?? p.materialLabel,
    })),
  }

  const legacy = legacyModel(withLabels.positions, materials, ratesLoad.rates)
  notes.push(...legacy.notes)

  const quote = refs.tech
    ? labQuote({ project: withLabels, tech: refs.tech, finance: refs.finance, legacy })
    : null
  if (!quote) notes.push('технический справочник не загружен: расчёт не выполнялся')

  return {
    quote, legacy, refs, notes,
    materials: materials.map(m => ({ id: m.id, name: m.name, thickness: m.thickness, category: m.category })),
  }
}
