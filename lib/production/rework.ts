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

// Список — словами владельца (14.10): он хочет видеть процент брака по изделиям в разрезе
// «бой при резке / бой при закалке / брак кромки / ошибка размера / рекламация». Место бывает
// известно из stage_key, но не всегда: на карточке заказа рабочий отмечает позицию, а не этап,
// и закалка у нас на стороне — стекло возвращается битым, когда этап закалки ещё открыт или уже
// закрыт. Поэтому «бой» разделён по месту прямо в причине: это вопрос, который задаёт отчёт.
export const REWORK_REASONS = [
  { code: 'break_cutting',   label: 'Бой при резке'      },
  { code: 'break_tempering', label: 'Бой при закалке'    },
  { code: 'edge_defect',     label: 'Брак кромки'        },
  { code: 'wrong_size',      label: 'Ошибка размера'     },
  { code: 'client_claim',    label: 'Рекламация клиента' },
  { code: 'other',           label: 'Другое'             },
] as const

export type ReworkReason = typeof REWORK_REASONS[number]['code']

// Коды первой версии (01.09) остаются допустимыми в базе — для чтения и подписи старых строк.
// Новых записей с ними нет: кнопки их больше не предлагают.
const LEGACY_REASON_LABELS: Record<string, string> = {
  break:           'Бой / скол',
  scratch:         'Царапина',
  material_defect: 'Брак материала',
}

export const REWORK_REASON_LABELS: Record<string, string> = {
  ...LEGACY_REASON_LABELS,
  ...Object.fromEntries(REWORK_REASONS.map(r => [r.code, r.label])),
}

export function isReworkReason(v: unknown): v is ReworkReason {
  return typeof v === 'string' && REWORK_REASONS.some(r => r.code === v)
}

// material_missing выведен: у «нет материала» своя работающая кнопка, и это не брак.
// equipment_down выведен: остановка станции — не дефект детали.

// ⚠️ ГИПОТЕЗА ОТ ФИЗИКИ СТЕКЛА, НЕ ОТ ДАННЫХ. Записей о браке в системе ноль, опереться не на
// что. Держится одной таблицей, чтобы поменять одной строкой, когда цех скажет, как на самом деле.
const SCRAPS_THE_PIECE: ReadonlySet<string> = new Set([
  'break_cutting', 'break_tempering', 'wrong_size', 'break', 'material_defect',
])

// Этап, на котором брак найден, когда у детали не осталось открытых этапов: она уже прошла цех
// (упакована, отгружена — рекламация). Строка, которой нет среди stage_key задач: переоткрывать
// от неё нечего, pickReopen вернёт пусто.
export const FOUND_AFTER_PRODUCTION = 'after_production'

export function foundAtLabel(stage: string, stageLabel: (k: string) => string): string {
  return stage === FOUND_AFTER_PRODUCTION ? 'после цеха' : stageLabel(stage)
}

// С какого этапа переоткрывать маршрут.
// Деталь в лом — с самого начала (её режут заново). Брак кромки — с полировки, но только пока
// стекло не закалено: калёное не шлифуют, и такая деталь тоже в лом. Рекламация и «другое» —
// с места обнаружения: у готовой детали это «после цеха», и маршрут не трогается — переделку
// по рекламации решает менеджер, а не кнопка в цеху.
export function restartStageFor(reason: string, foundAtStage: string, itemTasks: ReworkTask[] = []): string {
  if (SCRAPS_THE_PIECE.has(reason)) return 'cutting'
  if (reason === 'edge_defect') {
    const tempered = itemTasks.some(t => t.stage_key === 'tempering' && t.status === 'done')
    if (tempered) return 'cutting'
    return itemTasks.some(t => t.stage_key === 'polishing') ? 'polishing' : foundAtStage
  }
  return foundAtStage
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

// ─── Вход действия и план переделки ──────────────────────────────────────────
// Два экрана зовут одно действие: очередь (знает задачу, на которой нашли брак) и карточка
// заказа (знает только позицию). Обе формы сводятся к одному плану здесь, чтобы маршрут
// переоткрывался одинаково, с какого бы экрана ни нажали.

export type ReworkTarget = { taskId: number } | { orderId: number; itemIndex: number }

export type ReworkInput = {
  target:  ReworkTarget
  reason:  ReworkReason
  comment: string | null
  dryRun:  boolean
}

export const REWORK_COMMENT_MAX = 500

export function parseReworkBody(body: unknown): { ok: true; value: ReworkInput } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!isReworkReason(b.reason)) return { ok: false, error: 'Неизвестная причина' }
  const raw = typeof b.comment === 'string' ? b.comment.trim() : ''
  const comment = raw ? raw.slice(0, REWORK_COMMENT_MAX) : null
  const dryRun = b.dry_run === true

  if (b.task_id != null) {
    const taskId = Number(b.task_id)
    if (!Number.isInteger(taskId) || taskId <= 0) return { ok: false, error: 'Неверный id задачи' }
    return { ok: true, value: { target: { taskId }, reason: b.reason, comment, dryRun } }
  }
  const orderId = Number(b.order_id)
  const itemIndex = Number(b.item_index)
  if (!Number.isInteger(orderId) || orderId <= 0) return { ok: false, error: 'Не указан заказ' }
  if (b.item_index == null || b.item_index === '' || !Number.isInteger(itemIndex) || itemIndex < 0) {
    return { ok: false, error: 'Не указана позиция' }
  }
  return { ok: true, value: { target: { orderId, itemIndex }, reason: b.reason, comment, dryRun } }
}

export type ReworkPlan = {
  foundAtStage: string
  restartStage: string
  reopen:       ReworkTask[]
}

// Где нашли брак: задача, на которой нажали, — или фронтир позиции (первый незакрытый этап:
// там деталь сейчас и лежит). Открытых этапов нет — деталь прошла цех.
export function planRework(itemTasks: ReworkTask[], reason: string, foundTaskId?: number): ReworkPlan {
  const sorted = [...itemTasks].sort((a, b) => a.sequence_order - b.sequence_order)
  const found = foundTaskId != null
    ? sorted.find(t => t.id === foundTaskId)
    : sorted.find(t => t.status !== 'done')
  const foundAtStage = found?.stage_key ?? FOUND_AFTER_PRODUCTION
  const restartStage = restartStageFor(reason, foundAtStage, sorted)
  return { foundAtStage, restartStage, reopen: pickReopen(sorted, restartStage) }
}

// Карточка заказа и доска читают прогресс из notes.detail_stages (status === 'done').
// Переоткрытый этап там должен перестать быть «готово», иначе карточка показывает резку
// сделанной у детали, которую режут заново. Ключ не удаляется (mark_detail_stages умеет только
// ставить запись) — ставится запись со статусом reopened, которую все читатели видят не-done.
export function reopenedStageEntries(
  itemIndex: number,
  reopen: ReworkTask[],
  meta: { at: string; by: string; reasonLabel: string },
): { item: string; stage: string; entry: Record<string, unknown> }[] {
  const stages = [...new Set(reopen.map(t => t.stage_key))]
  return stages.map(stage => ({
    item:  String(itemIndex),
    stage,
    entry: { status: 'reopened', updated_at: meta.at, updated_by: meta.by, reason: `Переделка: ${meta.reasonLabel}` },
  }))
}
