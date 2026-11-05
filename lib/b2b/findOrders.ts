// Поиск заказа среди всех заказов (владелец 05.11.2026): отгруженные, архив и просчёты тоже находятся,
// и ответ сразу говорит, что с заказом. Наружу только номер, клиент и статус.
import type { SupabaseClient } from '@supabase/supabase-js'
import { PRODUCTION_STAGES } from '@/lib/productionStages'
import { ORDER_HIDDEN_LABEL, orderHidden, stripZeros } from '@/lib/production/clientShipments'
import { mskDayKey } from '@/lib/time'

export type FoundOrder = { id: number; no: string; client: string | null; created_day: string; status: string }

type Row = { id: number; custom_number: string | null; client_name: string | null; created_at: string; launched_at: string | null; archived_at: string | null; notes: string | null }
type Notes = { status?: string; historical?: boolean; stages?: Record<string, unknown> }
type OpenTask = { order_id: number; stage_key: string; sequence_order: number }

const COLS = 'id, custom_number, client_name, created_at, launched_at, archived_at, notes'
const LIMIT = 20

function ruDay(v: unknown): string {
  if (typeof v !== 'string' || Number.isNaN(new Date(v).getTime())) return ''
  const d = mskDayKey(new Date(v))
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
}

const stageLabel = (key: string) => PRODUCTION_STAGES.find(s => s.key === key)?.label ?? key

export function orderLookupStatus(row: Pick<Row, 'archived_at' | 'launched_at'>, notes: Notes, openStage: string | null): string {
  const hidden = orderHidden(row.archived_at, notes)
  if (hidden === 'archived') return `${ORDER_HIDDEN_LABEL.archived} с ${ruDay(row.archived_at)}`.trim()
  if (hidden) return ORDER_HIDDEN_LABEL[hidden]
  const stages = notes.stages ?? {}
  if (stages.shipped) return `Отгружен ${ruDay(stages.shipped)}`.trim()
  if (stages.packaged) return `Упакован ${ruDay(stages.packaged)}, ждёт отгрузки`.replace(' ,', ',')
  if (openStage) return `В работе: ${stageLabel(openStage)}`
  return row.launched_at ? 'Запущен, открытых задач цеха нет' : 'Не запущен'
}

function parse(raw: string | null): Notes {
  try { return raw ? JSON.parse(raw) as Notes : {} } catch { return {} }
}

// onlyCreatedBy: тот, кому не положено видеть все заказы, ищет только среди своих, как в списке заказов.
export async function findOrders(svc: SupabaseClient, raw: string, onlyCreatedBy: string | null = null): Promise<FoundOrder[]> {
  const text = raw.trim()
  const base = () => {
    const q = svc.from('b2b_orders').select(COLS)
    return onlyCreatedBy ? q.eq('created_by', onlyCreatedBy) : q
  }
  const digits = /^\d{1,9}$/.test(text) ? stripZeros(text) : ''
  if (!digits && text.length < 2) return []
  const like = `%${text.replace(/[\\%_]/g, m => `\\${m}`)}%`
  const parts = await Promise.all(digits
    ? [base().eq('id', Number(digits)), base().in('custom_number', [digits, `0${digits}`, `00${digits}`]), base().eq('client_order_number', text)]
    : [base().ilike('client_name', like).order('id', { ascending: false }).limit(LIMIT), base().ilike('client_order_number', like).order('id', { ascending: false }).limit(LIMIT)])
  const failed = parts.find(p => p.error)
  if (failed?.error) throw new Error(failed.error.message)
  const byId = new Map(parts.flatMap(p => (p.data ?? []) as unknown as Row[]).map(o => [o.id, o]))
  const rows = [...byId.values()].sort((a, b) => b.id - a.id).slice(0, LIMIT)
  if (rows.length === 0) return []

  const { data: tasks, error } = await svc.from('production_tasks')
    .select('order_id, stage_key, sequence_order')
    .in('order_id', rows.map(o => o.id)).in('status', ['queued', 'in_progress', 'problem'])
  if (error) throw new Error(error.message)
  const open = new Map<number, OpenTask>()
  for (const t of (tasks ?? []) as OpenTask[]) {
    const cur = open.get(t.order_id)
    if (!cur || t.sequence_order < cur.sequence_order) open.set(t.order_id, t)
  }
  return rows.map(o => ({
    id: o.id,
    no: o.custom_number?.trim() || `00${o.id}`,
    client: o.client_name,
    created_day: o.created_at.slice(0, 10),
    status: orderLookupStatus(o, parse(o.notes), open.get(o.id)?.stage_key ?? null),
  }))
}
