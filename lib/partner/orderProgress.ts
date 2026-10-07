import { stagesOf, isStageDone, stageDate } from '@/lib/b2b/stageDone'
import { deadlineFor } from '@/lib/b2b/deadline'

// Где заказ партнёра и как далеко продвинулся — одна модель для списка, карточки и табло.

export type PartnerLane = 'quote' | 'submitted' | 'in_work' | 'shipped'
export type TimelineState = 'done' | 'now' | 'wait'
export type TimelineRow = { label: string; state: TimelineState; date: string | null }

type Step = { key: string; short: string; long: string; legacy?: boolean }

// Порядок — как в /b2b-orders. «Чертёж» и «Материал» с 30.06 никто не отмечает: шаг
// показываем, только если отметка на заказе стоит, иначе свежий заказ вечно «на чертеже».
export const PRODUCTION_STEPS: readonly Step[] = [
  { key: 'printed', short: 'Чертёж', long: 'Чертёж подготовлен', legacy: true },
  { key: 'material_ordered', short: 'Материал', long: 'Материал получен', legacy: true },
  { key: 'cut', short: 'Резка', long: 'Резка' },
  { key: 'edge_processed', short: 'Полировка', long: 'Полировка кромки' },
  { key: 'drilled', short: 'Сверление', long: 'Сверление' },
  { key: 'tempering', short: 'Закалка', long: 'Закалка' },
  { key: 'packaged', short: 'Упаковка', long: 'Упаковка' },
]

// Статусы, которые менеджер видит как «в работе» (lib/b2b/points.ts IN_WORK_STATUSES).
const IN_WORK_STATUSES = ['sent', 'confirmed', 'in_production']

type Notes = Record<string, unknown>
type Row = { launched_at?: string | null; created_at: string }

export function noteStatus(notes: Notes): string {
  return typeof notes.status === 'string' && notes.status ? notes.status : 'quote'
}

export function isLaunched(row: Pick<Row, 'launched_at'>, notes: Notes): boolean {
  return !!row.launched_at || !!notes.launched_at || IN_WORK_STATUSES.includes(noteStatus(notes))
}

export type PartnerProgress = {
  lane: PartnerLane
  launched: boolean
  shipped: boolean
  packed: boolean
  ready: boolean
  progressPct: number
  stage: string
  timeline: TimelineRow[]
}

// Цех отмечает не каждый шаг (сверление и закалка нужны не всем деталям), но идёт по
// порядку: отмеченная упаковка значит, что резка позади. Поэтому прогресс — по самому
// дальнему отмеченному шагу, а не по числу отметок.
export function partnerProgress(row: Pick<Row, 'launched_at'>, notes: Notes): PartnerProgress {
  const stages = stagesOf(notes)
  const steps = PRODUCTION_STEPS.filter(s => !s.legacy || isStageDone(stages, s.key))
  let last = -1
  steps.forEach((s, i) => { if (isStageDone(stages, s.key)) last = i })

  const shipped = isStageDone(stages, 'shipped')
  const packed = isStageDone(stages, 'packaged')
  const launched = isLaunched(row, notes)
  const lane: PartnerLane = shipped ? 'shipped'
    : launched ? 'in_work'
    : noteStatus(notes) === 'pending_approval' ? 'submitted'
    : 'quote'
  const inProduction = lane === 'in_work' || lane === 'shipped'
  const ready = packed && !shipped

  const progressPct = !inProduction ? 0 : shipped ? 100 : Math.round(((last + 1) / steps.length) * 100)
  const stage = lane === 'shipped' ? 'Отгружен'
    : lane === 'submitted' ? 'Отправлен в работу'
    : lane === 'quote' ? 'Просчёт'
    : ready ? 'Готов к выдаче'
    : steps[last + 1]?.short ?? 'В работе'

  const timeline: TimelineRow[] = steps.map((s, i) => ({
    label: s.long,
    state: i <= last ? 'done' : (i === last + 1 && lane === 'in_work' ? 'now' : 'wait'),
    date: i <= last ? stageDate(stages, s.key) : null,
  }))
  timeline.push({
    label: 'Отгрузка',
    state: shipped ? 'done' : ready ? 'now' : 'wait',
    date: shipped ? stageDate(stages, 'shipped') : null,
  })

  return { lane, launched, shipped, packed, ready, progressPct, stage, timeline }
}

// Срок — от колонки launched_at: в notes.launched_at он есть у трети заказов.
export function partnerDeadline(row: Row, notes: Notes): Date {
  return deadlineFor({ ...notes, launched_at: notes.launched_at ?? row.launched_at ?? undefined }, row.created_at)
}
