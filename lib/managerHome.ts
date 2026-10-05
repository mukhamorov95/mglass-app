// Начальный экран менеджера (У2). Решение владельца 01.10: B2B-менеджер попадает
// на список просчётов, розничный — на сделки AmoCRM. В данных эти две работы ничем
// не различаются: у всех шести менеджеров права одинаковые (see_b2b и see_mglass),
// а делят их только привычки. Поэтому экран — настройка пользователя, а не догадка
// кода: владелец ставит её в /admin/users, пустое значение = главная «/» — «Утро»
// менеджера (docs/MANAGER_MORNING_ROUTE.md, М2).

export type ManagerHome = '/b2b-quotes' | '/manager'

export const MANAGER_HOMES: { value: ManagerHome; label: string }[] = [
  { value: '/b2b-quotes', label: 'Просчёты B2B' },
  { value: '/manager',    label: 'Сделки AmoCRM' },
]

export function normalizeManagerHome(v: unknown): ManagerHome | null {
  return MANAGER_HOMES.some(h => h.value === v) ? (v as ManagerHome) : null
}
