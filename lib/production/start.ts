// П2 — начало работы без трения (docs/PRODUCTION_PLAN.md).
//
// Кнопка «Взял» существует с 30.06 и собрала 0 нажатий за два месяца. Значит
// проблема не в отсутствии кнопки, и третья попытка того же провалится так же.
// Старт выводится из действия, которое рабочий и так совершает: он раскрывает
// карточку заказа на своей станции, чтобы посмотреть, что делать.
//
// Плата за слабый сигнал — риск «посмотрел и ушёл». Закрывается двумя способами:
//   1) started_via помечает, откуда сигнал, чтобы П4 не считала просмотр работой;
//   2) автостарт снимается сам, когда рабочий раскрывает другой заказ, — в работе
//      у человека остаётся ровно то, что он открыл последним.
// Явный «Взял» (button) не снимается никогда: это его осознанное решение.
//
// Чистая логика — ни Supabase, ни React.

import type { Actor } from './executor'

export type StartVia = 'button' | 'open' | 'scan'

export type StartCandidate = {
  id:                 number
  order_id:           number
  status:             string
  blocked_by_task_id: number | null
  started_at:         string | null
  assigned_to:        string | null
  started_via:        string | null
}

// Стартуем только то, что реально можно взять: задача в очереди и предыдущий этап
// детали закрыт. Готовность проверяем на сервере, а не доверяем списку из браузера,
// иначе автостарт открыл бы этап, до которого стекло ещё не доехало.
export function pickStartable(
  candidates: StartCandidate[],
  doneBlockerIds: Set<number>,
): StartCandidate[] {
  return candidates.filter(t =>
    t.status === 'queued' &&
    (t.blocked_by_task_id == null || doneBlockerIds.has(t.blocked_by_task_id)))
}

export function buildStartPatch(
  actor: Actor,
  task:  StartCandidate,
  now:   string,
  via:   StartVia,
): Record<string, unknown> {
  return {
    status:          'in_progress',
    started_at:      task.started_at ?? now,
    started_by:      actor.id,
    started_by_name: actor.name,
    started_via:     via,
    // assigned_to трогает ТОЛЬКО явное «Взял». Автостарт по раскрытию карточки
    // не должен уводить работу из общего пула станции: assigned_to питает фильтр
    // очереди (`assigned_to = я ИЛИ assigned_to пуст И станция моя`), и стоило бы
    // его проставить — второй рабочий этой задачи уже не увидел бы.
    ...(via === 'button' ? { assigned_to: task.assigned_to ?? actor.id } : {}),
  }
}

// Что вернуть в очередь: свои автостартованные задачи по ДРУГИМ заказам.
// Рабочий физически делает один заказ за раз; открытый ранее и брошенный
// не должен висеть «в работе» и портить и картину мастера, и длительность этапа.
export function pickAutoRelease(
  myInProgress: StartCandidate[],
  keepOrderId:  number | null,
): number[] {
  return myInProgress
    .filter(t => t.status === 'in_progress' && t.started_via === 'open' && t.order_id !== keepOrderId)
    .map(t => t.id)
}

// Возврат в очередь: снимаем и время начала, иначе брошенная задача принесёт
// в статистику часы, которых не было.
export const RELEASE_TASK_PATCH: Record<string, unknown> = Object.freeze({
  status:          'queued',
  started_at:      null,
  started_by:      null,
  started_by_name: null,
  started_via:     null,
  // assigned_to НЕ снимаем: если задача была за человеком по явному «Взял»,
  // снятие автостарта не отменяет его решения.
})
