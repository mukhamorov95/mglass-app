// Права на заявки на замер — одно место для API и экранов.
//
// Три круга:
//  · all      — владелец, коммерческий/финансы, менеджер с «видит всех клиентов», офис
//               (координирует замеры): все заявки целиком;
//  · measurer — замерщик: пул новых заявок целиком (ему ехать) и свои замеры;
//  · own      — менеджер (и закупщик с менеджерским контуром): свои заявки целиком,
//               на доске занятости у чужих — только время, замерщик и адрес.
// Логист видит доску (планирует монтажи рядом), но заявок не ведёт — круг own без своих.

import { canAccessRoute, isOwnerRole } from '@/lib/getRole'
import { seesAllDeals } from '@/lib/b2c/dealScope'

export type MeasureScope = 'all' | 'measurer' | 'own'

export type MeasureActor = {
  userId: string
  name: string
  role: string
  scope: MeasureScope
  // Может создавать заявки и назначать замерщика на свои заявки.
  canCreate: boolean
}

export function measureActorFrom(p: {
  userId: string
  name: string | null
  email?: string | null
  role: string
  canViewAllClients?: boolean | null
  managerWorkspace?: boolean
}): MeasureActor | null {
  const opts = { managerWorkspace: p.managerWorkspace === true }
  if (!canAccessRoute(p.role, '/measure-calendar', opts) && !canAccessRoute(p.role, '/measurer-cabinet', opts)) return null
  const scope: MeasureScope = p.role === 'measurer' ? 'measurer'
    : seesAllDeals(p.role, p.canViewAllClients) || p.role === 'office' ? 'all'
    : 'own'
  return {
    userId: p.userId,
    name: p.name || p.email || 'сотрудник',
    role: p.role,
    scope,
    canCreate: canAccessRoute(p.role, '/measure-requests', opts),
  }
}

export type MeasureRow = {
  id: number
  status: string
  manager_id: string | null
  measurer_id: string | null
}

export type MeasureAction = 'schedule' | 'unassign' | 'done' | 'issue' | 'cancel' | 'reopen' | 'fee_paid' | 'attach'

// Своя ли заявка для менеджерской стороны: создал её или видит все.
export function ownsRequest(a: MeasureActor, r: MeasureRow): boolean {
  return a.scope === 'all' || (a.canCreate && r.manager_id === a.userId)
}

// Можно ли действие над заявкой. Возвращает причину отказа для человека или null.
export function denyAction(a: MeasureActor, r: MeasureRow, action: MeasureAction): string | null {
  const owner = isOwnerRole(a.role)
  const mineAsMeasurer = a.role === 'measurer' && r.measurer_id === a.userId

  if (action === 'fee_paid') {
    if (!owner) return 'Выплату замерщику отмечает владелец'
    return r.status === 'done' ? null : 'Выплата — только по выполненному замеру'
  }
  if (owner) return null

  switch (action) {
    case 'schedule':
      if (a.role === 'measurer') {
        if (r.status === 'new' || mineAsMeasurer) return null
        return 'Заявку уже взял другой замерщик'
      }
      return ownsRequest(a, r) ? null : 'Назначать можно только по своей заявке'
    case 'unassign':
      return mineAsMeasurer || ownsRequest(a, r) ? null : 'Это не ваш замер'
    case 'done':
    case 'issue':
    case 'attach':
      return mineAsMeasurer || a.scope === 'all' ? null
        : action === 'attach' && ownsRequest(a, r) ? null
        : 'Отметку ставит замерщик этого замера'
    case 'cancel':
    case 'reopen':
      return ownsRequest(a, r) ? null : 'Отменить может менеджер заявки или владелец'
  }
}

// Какие статусы допускают действие — чтобы «выполнен» не ставили на отменённый.
export const ALLOWED_FROM: Record<Exclude<MeasureAction, 'attach'>, string[]> = {
  schedule: ['new', 'scheduled', 'issue'],
  unassign: ['scheduled', 'issue'],
  done: ['scheduled', 'issue'],
  issue: ['scheduled', 'done'],
  cancel: ['new', 'scheduled', 'issue'],
  reopen: ['cancelled'],
  fee_paid: ['done'],
}
