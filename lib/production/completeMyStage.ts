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

// Одна кнопка — одна станция (владелец, 25.09.2026). У Эльзата в профиле резка и
// полировка: общая кнопка закрывала обе разом, и полировка числилась сделанной
// в ту же секунду, что резка, — а следующие станции видели деталь готовой.
// Здесь — мои открытые задачи по заказу, разложенные по станциям в порядке маршрута.
export type StationGroup = { station: string; count: number }

export function myStationGroups(tasks: StationTask[], stations: string[], userId?: string): StationGroup[] {
  const byStation = new Map<string, { count: number; seq: number }>()
  for (const t of pickMyStageTasks(tasks, stations, userId)) {
    const e = byStation.get(t.station) ?? { count: 0, seq: t.sequence_order }
    e.count++
    e.seq = Math.min(e.seq, t.sequence_order)
    byStation.set(t.station, e)
  }
  return [...byStation].sort((a, b) => a[1].seq - b[1].seq).map(([station, e]) => ({ station, count: e.count }))
}

// Какую станцию закрыть по запросу. Станцию называет рабочий; сервер проверяет,
// что она его. Без станции закрываем, только если открыта ровно одна: старая
// вкладка на телефоне в цеху, открытая до этой правки, не должна закрыть всё разом.
export type StationChoice = { station: string | null } | { error: string; status: number }

export function chooseStation(groups: StationGroup[], requested: unknown, profileStations: string[]): StationChoice {
  if (typeof requested === 'string' && requested) {
    if (!profileStations.includes(requested)) return { error: 'Это не ваша станция', status: 403 }
    return { station: requested }
  }
  if (groups.length === 0) return { station: null }
  if (groups.length === 1) return { station: groups[0].station }
  return { error: 'Отметьте каждую станцию отдельно — обновите страницу', status: 409 }
}

// «Готово всё по детали» закрывает последний открытый этап маршрута, остальное — каскад.
// Уместно, только когда после моего первого открытого этапа идут одни мои станции
// (закалка → упаковка у Никиты). Если дальше чужая станция, кнопка закрыла бы за неё
// работу: у Эльзата после полировки — сверловка, закалка, упаковка.
export type RouteStage = { station: string; status: string; sequence_order: number }

export function canCompleteWholeDetail(route: RouteStage[], stations: string[]): boolean {
  const open = route.filter(r => r.status !== 'done').sort((a, b) => a.sequence_order - b.sequence_order)
  if (open.length < 2) return false
  const mine = new Set(stations)
  const first = open.findIndex(r => mine.has(r.station))
  if (first < 0) return false
  return open.slice(first).every(r => mine.has(r.station))
}
