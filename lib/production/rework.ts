// П3 (+П5, слиты оркестратором) — переделка как рабочее действие.
//
// Почему не «отметить брак». За два месяца при 3670 задачах в системе три записи о браке.
// Причина не в цене нажатия, а в цене последствий: кнопка «Проблема» переводила задачу в
// статус problem, то есть вынимала её из потока, и закрывать её потом шёл тот же человек.
// Кнопка создавала рабочему работу. Для сравнения — «Нет материала» такой же дешёвый тап,
// но используется (83 заказа), потому что ДАЁТ результат: заказ подсвечивается на закупку.
//
// Что рабочему нужно на самом деле: сказать «эту деталь надо изготовить заново». Сейчас
// сказать это нечем — ранние этапы стоят done, и очередь показывает деталь готовой к
// следующему этапу. После боя приложение врёт, а правду он держит в голове.
//
// Поэтому действие называется «Переделать» и возвращает маршрут детали назад. Очередь
// становится правдой — это то, что нужно ему. Запись брака остаётся побочным эффектом —
// это то, что нужно бизнесу. Ровно та же линия, что в П1 и П2.
//
// Чистая логика — ни Supabase, ни React.

export const REWORK_REASONS = [
  { code: 'break',           label: 'Бой / скол'      },
  { code: 'scratch',         label: 'Царапина'        },
  { code: 'wrong_size',      label: 'Неверный размер' },
  { code: 'material_defect', label: 'Брак материала'  },
  { code: 'other',           label: 'Другое'          },
] as const

export type ReworkReason = typeof REWORK_REASONS[number]['code']

export const REWORK_REASON_LABELS: Record<string, string> =
  Object.fromEntries(REWORK_REASONS.map(r => [r.code, r.label]))

export function isReworkReason(v: unknown): v is ReworkReason {
  return typeof v === 'string' && REWORK_REASONS.some(r => r.code === v)
}

// Список причин сокращён с 11 андон-кодов до 5, потому что ЭТАП УЖЕ ИЗВЕСТЕН.
// «Брак закалки», «брак полировки», «брак сверления» — это не причины, а места, и место
// приходит из stage_key. Причина отвечает только на «что случилось».
// material_missing выведен: у «нет материала» своя работающая кнопка, и это не брак.
// equipment_down выведен: остановка станции — не дефект детали.

// ⚠️ ГИПОТЕЗА ОТ ФИЗИКИ СТЕКЛА, НЕ ОТ ДАННЫХ. Записей о браке в системе три штуки,
// опереться не на что. Держится одной таблицей, чтобы поменять одной строкой, когда цех
// скажет, как на самом деле. Вопрос к цеху открыт: царапина — это лом или перешлифовка?
const SCRAPS_THE_PIECE: ReadonlySet<string> = new Set(['break', 'wrong_size', 'material_defect'])

// С какого этапа переоткрывать маршрут.
// Деталь в лом — с самого начала (её режут заново). Остальное — с места обнаружения:
// если этап ещё не закрыт, рабочему и переделывать нечего, он просто продолжает, и тогда
// ценность действия — только в записи брака.
export function restartStageFor(reason: ReworkReason, foundAtStage: string): string {
  return SCRAPS_THE_PIECE.has(reason) ? 'cutting' : foundAtStage
}

export type ReworkTask = {
  id:             number
  stage_key:      string
  sequence_order: number
  status:         string
}

// Какие задачи детали вернуть в очередь: всё, что идёт с этапа перезапуска и дальше.
// Порог берём по МИНИМАЛЬНОМУ sequence_order этапа: у триплекса одна и та же резка живёт
// в нескольких слоях с разными номерами, и брать первый попавшийся значило бы переоткрыть
// пакет наполовину. Переоткрываем весь — пересобрать триплекс из одного нового стекла
// нельзя, склейка идёт целиком.
export function pickReopen(itemTasks: ReworkTask[], restartStage: string): ReworkTask[] {
  const stageSeqs = itemTasks.filter(t => t.stage_key === restartStage).map(t => t.sequence_order)
  if (stageSeqs.length === 0) return []
  const from = Math.min(...stageSeqs)
  return itemTasks.filter(t => t.sequence_order >= from)
}

// Патч переоткрытия. Снимает и факт исполнения, и сигнал начала работы: этап предстоит
// сделать заново, и прежний исполнитель не должен получить его в выработку дважды за одну
// физическую деталь — второй раз он получит, когда закроет переделку.
export const REOPEN_TASK_PATCH: Record<string, unknown> = Object.freeze({
  status:              'queued',
  completed_at:        null,
  completed_by:        null,
  completed_by_name:   null,
  started_at:          null,
  started_by:          null,
  started_by_name:     null,
  started_via:         null,
  problem_at:          null,
  problem_resolved_at: null,
  problem_reason_code: null,
  problem_comment:     null,
  problem_by:          null,
  auto_closed:         false,
})
