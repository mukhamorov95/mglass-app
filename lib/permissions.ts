// Shared types and constants — no server dependencies, safe for client components

import type { ManagerHome } from './managerHome'

// mglass_only — закупщик считает только для внутреннего клиента M GLASS.
// all_clients — закупщик (напр. Вера) считает для ВСЕХ B2B-клиентов, как менеджер.
// null — обычный режим роли (для закупщика калькулятор закрыт).
export type B2BClientScope = 'mglass_only' | 'all_clients'

export type UserPermissions = {
  see_mglass:        boolean
  see_b2b:           boolean
  see_calendar:      boolean
  see_clients:       boolean
  see_earnings:      boolean
  b2b_client_scope?: B2BClientScope | null
  // Второе рабочее пространство «Менеджер» поверх роли закупщика (Вера): полный
  // контур MGlass (B2C) + B2B как у менеджера, с переключателем вкладок в сайдбаре.
  // Даёт доступ к менеджерским маршрутам В ДОПОЛНЕНИЕ к контуру закупщика/логиста.
  manager_workspace?: boolean
  // Начальный экран: куда уводить с «/» (У2). Пусто — общая панель.
  home_route?: ManagerHome | null
  // «Маржа» в «Воронке и продажах»: видеть и дописывать расходы объектов (решение
  // владельца 05.10 — Вере). Владельцы видят маржу и без этого права.
  margin_edit?: boolean
  // «Табло цеха»: ставить и двигать поручения наравне с владельцем и цехом (решение
  // владельца 08.10 — Диме). Остальные сотрудники видят табло и пишут комментарии.
  shop_board?: boolean
}

export const DEFAULT_PERMISSIONS: UserPermissions = {
  see_mglass:        true,
  see_b2b:           true,
  see_calendar:      true,
  see_clients:       true,
  see_earnings:      true,
  b2b_client_scope:  null,
  manager_workspace: false,
  home_route:        null,
  margin_edit:       false,
}
