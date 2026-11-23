// Роли сотрудников партнёра и что каждой можно (docs/PARTNER_TEAM_ROUTE.md). Одна матрица:
// её читают сервер (/api/partner/*) и меню кабинета. Права режет сервер — в ответе
// кладовщика цен нет вовсе, а не спрятаны на экране.

export const TEAM_ROLES = ['admin', 'manager', 'accountant', 'storekeeper'] as const
export type TeamRole = typeof TEAM_ROLES[number]

export const TEAM_ROLE_RU: Record<TeamRole, string> = {
  admin: 'Руководитель',
  manager: 'Менеджер',
  accountant: 'Бухгалтер',
  storekeeper: 'Кладовщик',
}

export type TeamPerm =
  | 'prices'     // цены и суммы
  | 'calc'       // калькулятор, просчёты, отправка в работу, согласование чертежа, прилавок
  | 'payStatus'  // оплачен / ожидает оплаты
  | 'finance'    // счета, УПД, реквизиты, онлайн-оплата
  | 'delivery'   // получение и доставка
  | 'claims'     // гарантия
  | 'team'       // команда: пригласить, роль, отключить

const MATRIX: Record<TeamRole, readonly TeamPerm[]> = {
  admin: ['prices', 'calc', 'payStatus', 'finance', 'delivery', 'claims', 'team'],
  manager: ['prices', 'calc', 'payStatus', 'delivery', 'claims'],
  accountant: ['prices', 'payStatus', 'finance'],
  storekeeper: ['delivery', 'claims'],
}

export const isTeamRole = (v: unknown): v is TeamRole => typeof v === 'string' && (TEAM_ROLES as readonly string[]).includes(v)

export function can(role: TeamRole, perm: TeamPerm): boolean {
  return MATRIX[role].includes(perm)
}

export function permsOf(role: TeamRole): Record<TeamPerm, boolean> {
  const all: TeamPerm[] = ['prices', 'calc', 'payStatus', 'finance', 'delivery', 'claims', 'team']
  return Object.fromEntries(all.map(p => [p, can(role, p)])) as Record<TeamPerm, boolean>
}

export const PERM_DENIED: Record<TeamPerm, string> = {
  prices: 'Цены вашей роли не видны — обратитесь к руководителю',
  calc: 'Просчёты делают руководитель и менеджеры',
  payStatus: 'Оплаты видят руководитель, менеджер и бухгалтер',
  finance: 'Счета и реквизиты — у руководителя и бухгалтера',
  delivery: 'Получение и доставку ведут руководитель, менеджер и кладовщик',
  claims: 'Претензии оформляют руководитель, менеджер и кладовщик',
  team: 'Команду ведёт руководитель',
}
