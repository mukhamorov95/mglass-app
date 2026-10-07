// Пустой экран «Мои задачи» обязан сказать, почему он пустой. Раньше три разных случая
// выглядели одинаково — «Нет задач в очереди»: у человека не назначена станция (очередь
// и не может наполниться), очередь не загрузилась (сеть, сессия) и задач правда нет.
// Рабочий в первых двух случаях уходит домой с чистой совестью, а работа стоит.

export type QueueEmpty = 'error' | 'no-station' | 'empty'

export function queueEmptyState(opts: {
  loadError: string | null
  stations: string[]
  assignedToMe: number
  visible: number
}): QueueEmpty | null {
  if (opts.loadError) return 'error'
  if (opts.visible > 0) return null
  // Без станций очередь собирается только из назначенного лично — если и его нет,
  // дело в профиле, а не в работе.
  if (opts.stations.length === 0 && opts.assignedToMe === 0) return 'no-station'
  return 'empty'
}

