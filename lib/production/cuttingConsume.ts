// Списание материала в момент закрытия РЕЗКИ (решение владельца 27.08.2026,
// 05-РЕШЕНИЯ/2026-08-27-списание-материала-в-момент-резки.md).
//
// Раньше списывали на упаковке. Замер показал, почему это неверно: резка — самый живой
// этап цеха (834 живых отметки против 337 у упаковки), до упаковки доходит треть задач,
// и материал физически расходуется именно на резке.
//
// ─── Почему решает отдельный модуль, а не условие на месте ───────────────────
// Закрыть резку можно ТРЕМЯ путями: очередь цеха (api/production-tasks/[id]), карточка
// заказа и QR-экран (api/b2b-orders/[id]/sync-stages), «Всё готово»
// (api/production/complete-order). Плюс каскад, который закрывать умеет, а списывать
// не должен. Условие, размноженное по трём файлам, разъедется — это уже было со счётчиком
// «Всё готово», который считал не то же, что делал сервер.
//
// ─── Живая отметка, а не status = 'done' ─────────────────────────────────────
// После снятия блокировки отметки (#351) рабочий закрывает свой этап, даже если предыдущий
// никто не отметил, и пропущенное закрывается каскадом с auto_closed. Списание по статусу
// начало бы списывать материал по деталям, которые физически ещё не резали.
// Поэтому решение принимается по ИСТОЧНИКУ отметки, а не по её результату.
//
// Чистая логика — ни Supabase, ни React.

export const CUTTING_STAGE = 'cutting'

// Откуда пришла отметка. Каскад присутствует в перечислении сознательно: он должен быть
// назван и явно отвергнут, а не забыт.
export type MarkSource = 'worker' | 'order-card' | 'complete-order' | 'cascade'

export type CuttingMark = {
  orderId:   number
  itemIndex: number
  stageKey:  string
  source:    MarkSource
  /** production_tasks.rework_count на момент отметки. 0 — деталь режут впервые. */
  attempt:   number
}

export type ConsumeIntent = {
  orderId:   number
  itemIndex: number
  /** Ключ идемпотентности на стороне склада — (заказ, позиция, попытка). */
  attempt:   number
}

// Отметка списывает материал, только если это ЖИВОЕ закрытие резки.
// Каскад отвергается здесь и больше нигде: одно место, где это решается.
export function shouldConsume(mark: CuttingMark): boolean {
  if (mark.stageKey !== CUTTING_STAGE) return false
  return mark.source !== 'cascade'
}

// Что отдать складу по пачке отметок. Дубли по (позиция, попытка) схлопываются:
// «Всё готово» может прислать несколько отметок одной детали за один запрос.
export function planConsume(marks: CuttingMark[]): ConsumeIntent[] {
  const seen = new Set<string>()
  const out: ConsumeIntent[] = []
  for (const m of marks) {
    if (!shouldConsume(m)) continue
    const key = `${m.orderId}:${m.itemIndex}:${m.attempt}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ orderId: m.orderId, itemIndex: m.itemIndex, attempt: m.attempt })
  }
  return out
}

// ─── Отмена отметки: два разных случая, два разных последствия ───────────────
// Отмена этапа (мисклик, «отметили не тот заказ») — материал НЕ расходовался, нужно
// встречное движение: иначе ошибка молча уводит остаток, и потом никто не поймёт, отчего
// цифра неверна. Для склада «неверно и непонятно почему» хуже, чем «данных нет».
// «Переделать» — материал израсходован, откат не нужен: дальше спишется следующая попытка
// (attempt вырос), и это физически верно — взяли новый лист.
export type ReopenReason = 'unset' | 'rework'

export function shouldReverse(stageKey: string, reason: ReopenReason): boolean {
  return stageKey === CUTTING_STAGE && reason === 'unset'
}
