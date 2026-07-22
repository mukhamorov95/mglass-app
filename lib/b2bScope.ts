// B2B per-client access scope helpers — used by B2B calculator/quotes/orders.
// The "M GLASS only" scope restricts a manager (e.g. Vera) to internal M GLASS work.

import type { UserPermissions } from './permissions'

// Canonical id of the internal M GLASS client in b2b_clients. Source of truth.
export const MGLASS_CLIENT_IDS: ReadonlyArray<number> = [1]

// Defensive fallback if a row's id changed but the name is intact. Normalised
// (uppercased, stripped of spaces and dashes) before comparison.
const MGLASS_NAME_ALIASES: ReadonlyArray<string> = [
  'MGLASS',
  'MGLASS-',
  'M-GLASS',
  'МГЛАЗ',
]

function normName(s: string | null | undefined): string {
  return String(s ?? '').toUpperCase().replace(/[\s\-_]/g, '')
}

type ClientLike = { id?: number | null; name?: string | null } | null | undefined

export function isMGlassClient(client: ClientLike): boolean {
  if (!client) return false
  if (client.id != null && MGLASS_CLIENT_IDS.includes(client.id)) return true
  const n = normName(client.name)
  return n.length > 0 && MGLASS_NAME_ALIASES.includes(n)
}

export function isMGlassOnlyUser(permissions: UserPermissions | null | undefined): boolean {
  return permissions?.b2b_client_scope === 'mglass_only'
}

// Закупщик с этим скоупом считает для всех клиентов (Вера ведёт не только M GLASS).
export function isAllClientsScope(permissions: UserPermissions | null | undefined): boolean {
  return permissions?.b2b_client_scope === 'all_clients'
}

// Есть ли у закупщика доступ к B2B-калькулятору вообще (любой явный скоуп).
// Без него роль buyer в калькулятор не пускается — закупка не продаёт.
export function hasB2BSalesScope(permissions: UserPermissions | null | undefined): boolean {
  const s = permissions?.b2b_client_scope
  return s === 'mglass_only' || s === 'all_clients'
}

// Human-readable error to surface in the UI when a scope-restricted manager
// attempts to operate on a non-M-GLASS client.
export const MGLASS_SCOPE_ERROR =
  'Вам доступно создание и запуск B2B-заказов только для клиента M GLASS.'
