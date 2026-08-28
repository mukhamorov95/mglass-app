// Что закроется, когда рабочий жмёт «Готово на моей станции» по заказу.
//
// Чистая функция и отдельный файл — потому что счётчик на кнопке должен показывать
// РОВНО то, что сделает сервер. Кнопка, обещавшая закрыть 5 задач и закрывшая 61,
// у нас уже была: считали в браузере одно, сервер делал другое.

export type StationTask = {
  id:             number
  item_index:     number
  sequence_order: number
  status:         string
  stage_key:      string
  station:        string
  rework_count:   number | null
  started_at:     string | null
  assigned_to:    string | null
  started_by:     string | null
}

// Мои открытые задачи по заказу: только мои станции, только незакрытые.
// Проблемные закрываем тоже — рабочий разобрался с деталью и ведёт её дальше.
//
// Задачу, которую ЯВНО взял другой человек, не трогаем. Две причины, и обе важны:
// его отметка «Взял» — осознанное решение, а очередь на экране такие задачи и не
// показывает, значит счётчик на кнопке разошёлся бы с тем, что делает сервер.
export function pickMyStageTasks(tasks: StationTask[], stations: string[], userId?: string): StationTask[] {
  const mine = new Set(stations)
  return tasks
    .filter(t => mine.has(t.station) && t.status !== 'done')
    .filter(t => !t.assigned_to || !userId || t.assigned_to === userId)
    .sort((a, b) => a.item_index - b.item_index || a.sequence_order - b.sequence_order)
}

// Сколько задач закроется — для подписи на кнопке.
export function countMyStageTasks(tasks: StationTask[], stations: string[], userId?: string): number {
  return pickMyStageTasks(tasks, stations, userId).length
}
