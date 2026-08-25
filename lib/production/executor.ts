// П1 — исполнитель производственной задачи (docs/PRODUCTION_PLAN.md).
//
// Разделение, на котором всё держится:
//   assigned_to  — ПЛАН: кому задача адресована. По нему строится личная очередь
//                  (assigned_to = я ИЛИ assigned_to пуст И станция моя), на нём же
//                  будут стоять плановый день и балансировка (П11/П12).
//   completed_by — ФАКТ: кто нажал «Готово». На нём стоит выработка (П16) и брак (П15).
// Одно поле на две роли сделало бы неверными обе.
//
// Рабочий не делает ни одного лишнего действия: всё выводится из той кнопки,
// которую он и так нажимает. Чистая логика — ни Supabase, ни React.

export type TaskAction = 'start' | 'done' | 'problem'

export type Actor = { id: string; name: string | null }

export type TaskSnapshot = {
  status:      string
  started_at:  string | null
  assigned_to: string | null
}

export type ProblemInput = { reasonCode: string; comment: string | null }

// Патч для production_tasks по действию рабочего.
// `now` передаётся снаружи — одна отметка времени на весь запрос (задача + каскад + зеркала).
export function buildTaskUpdate(
  action:  TaskAction,
  actor:   Actor,
  task:    TaskSnapshot,
  now:     string,
  problem?: ProblemInput,
): Record<string, unknown> {
  if (action === 'start') {
    return {
      status:      'in_progress',
      started_at:  task.started_at ?? now,
      // Взял в работу = задача его. Не перетираем чужое назначение.
      assigned_to: task.assigned_to ?? actor.id,
      // Явное нажатие — сильный сигнал, в отличие от автостарта по раскрытию карточки (П2).
      started_via: 'button',
    }
  }

  if (action === 'done') {
    return {
      status:              'done',
      completed_at:        now,
      // Нажал «Готово», не нажав «В работу»: считаем, что работа шла с этого момента,
      // иначе длительность этапа (П4) считалась бы от создания задачи.
      started_at:          task.started_at ?? now,
      problem_resolved_at: now,   // снимаем андон, если был
      completed_by:        actor.id,
      completed_by_name:   actor.name,
      assigned_to:         task.assigned_to ?? actor.id,
    }
  }

  return {
    status:              'problem',
    problem_reason_code: problem?.reasonCode ?? 'other',
    problem_comment:     problem?.comment ?? null,
    problem_at:          now,
    problem_resolved_at: null,
    problem_by:          actor.id,
    problem_by_name:     actor.name,
    // assigned_to СОЗНАТЕЛЬНО не трогаем: после снятия андона задача вернётся
    // в 'queued', и приватная привязка спрятала бы её от станции — работу
    // не увидел бы никто, кроме поднявшего проблему.
  }
}

// Отмена этапа со старых экранов: снимаем и факт исполнения, иначе в задаче
// остался бы исполнитель у невыполненной работы (и он попал бы в выработку).
export const UNSET_TASK_PATCH: Record<string, unknown> = Object.freeze({
  status:              'queued',
  completed_at:        null,
  started_at:          null,
  started_via:         null,   // вернулась в очередь — прежний сигнал начала работы недействителен (П2)
  completed_by:        null,
  completed_by_name:   null,
  problem_at:          null,
  problem_resolved_at: null,
  problem_reason_code: null,
  problem_comment:     null,
  problem_by:          null,
})

// Патч закрытия этапа со старых экранов (карточка заказа, QR). Тот же факт
// исполнения, что и в очереди цеха, — иначе половина отметок была бы безымянной.
export function buildSyncDonePatch(actor: Actor, now: string): Record<string, unknown> {
  return {
    status:              'done',
    completed_at:        now,
    problem_resolved_at: now,
    completed_by:        actor.id,
    completed_by_name:   actor.name,
  }
}

// Имя для показа: как в остальном коде цеха — имя из профиля, иначе почта.
export function actorName(profileName: string | null | undefined, email: string | null | undefined): string | null {
  return (profileName ?? '').trim() || (email ?? '').trim() || null
}
