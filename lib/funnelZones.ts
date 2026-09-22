// Зона этапа воронки «Продажи» AmoCRM по его названию. Канон — таблица зон в SYSTEM.md.
// Одна функция на всё приложение: Sales Monitor, «Мои сделки», табло каналов.
// Зона 1 — квалификация:  Получена новая заявка … Готов купить
// Зона 2 — продажа:       Замер назначен … Счёт выставлен — ждём оплату
// Зона 3 — производство:  Оплата сделана … Оплата дизайнером

export type FunnelZone = 1 | 2 | 3

export function amoStageZone(name: string): FunnelZone | null {
  const n = name.toLowerCase()

  if (n.includes('новая заявка')       ||
      n.includes('назначен ответственный') ||
      n.includes('проработка')         ||
      n.includes('разговор состоялся') ||
      n.includes('долгострой')         ||
      n.includes('готов купить')) return 1

  if (n.includes('замер')              ||
      n.includes('согласование')       ||
      n.includes('чертежи в работу')   ||
      n.startsWith('кп')              ||
      n.includes('счёт выставлен')    || n.includes('счет выставлен') ||
      n.includes('ждём оплату')       || n.includes('ждем оплату')) return 2

  // В AmoCRM этап называется «оплата дизайнерам», в таблице — «Оплата дизайнером»:
  // по полному слову 23 оплаченные сделки выпадали из зоны 3.
  if (n.includes('оплата сделана')     ||
      n.includes('оплата получена')    ||
      n.includes('счёт оплачен')      || n.includes('счет оплачен') ||
      n.includes('заказ в работе')     ||
      n.includes('к монтажу')          ||
      n.includes('монтаж')             ||
      n.includes('рекламация')         ||
      n.includes('оплата остатка')     ||
      n.includes('оплата дизайнер')) return 3

  return null
}
