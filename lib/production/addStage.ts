import { PRODUCTION_STAGES } from '@/lib/productionStages'

// Добавление пропущенного этапа к уже запущенному заказу.
//
// Зачем. Маршрут строится из признаков просчёта: нет отметки «отверстия» — нет
// задачи сверловки. 01.09.2026 Адилет пришёл с четырьмя заказами (05238, 05329,
// 05353, 05368), которые он физически сверлит, а в приложении их не видел: у всех
// семи позиций стояло hasHoles = false. Менеджер не отметил — цех не узнал.
//
// Ждать, пока все менеджеры перестанут ошибаться, нельзя: работа стоит сегодня.
// Поэтому рабочий может добавить СВОЙ этап к заказу сам. Чужой — не может:
// границу считает сервер по станциям профиля.

export type ExistingTask = { item_index: number; stage_key: string; sequence_order: number }

// Позиция этапа в каноническом маршруте. Нужна, чтобы вставленный этап встал на
// своё место, а не в конец: сверловка идёт после полировки и до закалки.
export function canonicalIndex(stageKey: string): number {
  const i = PRODUCTION_STAGES.findIndex(s => s.key === stageKey)
  return i < 0 ? PRODUCTION_STAGES.length : i
}

// Полная перенумерация этапов детали после вставки.
//
// Просто дать новому этапу номер из общего маршрута нельзя: у существующих задач
// номера присвоены БЕЗ него (резка 1, полировка 2, закалка 3), и сверловка получила
// бы 3 — тот же номер, что у закалки. Дальше цепочка «кто кого ждёт» строится
// сортировкой по номеру, и совпадение делает её неопределённой.
// Поэтому нумеруем заново все этапы детали по каноническому порядку.
export function renumberItem(tasks: ExistingTask[], addStage: string): { stage_key: string; sequence_order: number; isNew: boolean }[] {
  const keys = [...new Set([...tasks.map(t => t.stage_key), addStage])]
  return keys
    .sort((a, b) => canonicalIndex(a) - canonicalIndex(b))
    .map((stage_key, i) => ({ stage_key, sequence_order: i + 1, isNew: !tasks.some(t => t.stage_key === stage_key) }))
}

// Нужно ли вообще что-то добавлять по этой детали.
export function itemNeedsStage(tasks: ExistingTask[], itemIndex: number, stage: string): boolean {
  return !tasks.some(t => t.item_index === itemIndex && t.stage_key === stage)
}
