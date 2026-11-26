import { fingerprint, type Meta } from '../values'

// Технологические нормы — версионируемые данные, а не код: уточнение замером даёт новую
// версию набора, прежние результаты остаются со своим отпечатком.
export const NORM_OPS = ['cutting', 'edge', 'curved', 'drilling', 'cutout', 'sandblast', 'film', 'design',
  'frame_cutting', 'frame_welding', 'assembly', 'packaging', 'transport'] as const
export type NormOp = typeof NORM_OPS[number]

export type Norm = Meta & {
  op: NormOp
  setupMin: number | null          // наладка на технологическую партию
  perPartMin: number | null        // установка и снятие детали
  perUnitMin: number | null        // на единицу объёма (м.п., м², отверстие, штука)
  machineMinPerUnit: number | null // из человеко-минут не выводится
  sample?: number                  // число замеров
}

export type NormSet = { id: string; version: number; date: string; norms: Norm[] }

const labour = (n: Norm) => [n.setupMin, n.perPartMin, n.perUnitMin]

export function normSetErrors(set: NormSet): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const n of set.norms) {
    if (!(NORM_OPS as readonly string[]).includes(n.op)) errors.push(`${n.op}: неизвестная операция`)
    if (seen.has(n.op)) errors.push(`${n.op}: норма задана дважды`)
    seen.add(n.op)
    if (!n.source) errors.push(`${n.op}: не указан источник`)
    if (n.status === 'missing' && labour(n).some(v => v != null)) errors.push(`${n.op}: «нет значения» с цифрами`)
    if (n.status !== 'missing' && labour(n).some(v => v == null || !(v >= 0))) errors.push(`${n.op}: неполная норма`)
    if (n.status === 'measured' && !((n.sample ?? 0) >= 1)) errors.push(`${n.op}: «измерено» без объёма выборки`)
  }
  return errors
}

export const normSetStamp = (set: NormSet) => `${set.id}@${set.version}#${fingerprint(set)}`
