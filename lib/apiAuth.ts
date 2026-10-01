import { NextResponse } from 'next/server'
import { getRole, getSessionUser, getUserProfile, canAccessRoute, isOwnerRole, type Role } from './getRole'

// Shared 403 response — keeps Russian copy consistent across endpoints.
function forbidden() {
  return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })
}

// Owner-tier API gate: admin + ceo pass. Use for any owner-level write/read.
// Usage:
//   const guard = await requireOwner()
//   if (guard instanceof NextResponse) return guard
//   const role = guard
export async function requireOwner(): Promise<Role | NextResponse> {
  const role = await getRole()
  if (!isOwnerRole(role)) return forbidden()
  return role as Role
}

// Strict admin-only gate. Use only for irreversible / system operations
// (git sync, mass user seeding, raw migrations).
export async function requireAdmin(): Promise<Role | NextResponse> {
  const role = await getRole()
  if (role !== 'admin') return forbidden()
  return role
}

// Allowlist gate: pass if the caller's role is in `allowed`. Use for routes
// shared by a specific set of roles (e.g. owner + buyer for procurement).
// Owner roles must be listed explicitly when they should pass.
export async function requireRole(allowed: Role[]): Promise<Role | NextResponse> {
  const role = await getRole()
  if (!role || !allowed.includes(role)) return forbidden()
  return role
}

// Эндпоинт экрана пускает ровно тех, кто может открыть сам экран. middleware
// не гейтит /api/* (canAccessRoute пропускает их все), поэтому без этой строки
// маршрут открыт любой роли с сессией — партнёру, цеху, замерщику. Скоуп и
// manager_workspace берём из профиля, как middleware: закупщик с кабинетом
// менеджера проходит, тот же закупщик без него — нет.
export async function requirePageAccess(pathname: string): Promise<Role | NextResponse> {
  return requireAnyPageAccess([pathname])
}

// Эндпоинт, которым пользуются несколько экранов: пускает, если открыт хотя бы один.
export async function requireAnyPageAccess(pathnames: string[]): Promise<Role | NextResponse> {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Нужно войти' }, { status: 401 })
  const profile = await getUserProfile()
  if (!profile) return forbidden()
  const { role, permissions } = profile
  const opts = { b2bScope: permissions.b2b_client_scope ?? null, managerWorkspace: permissions.manager_workspace === true }
  if (!pathnames.some(p => canAccessRoute(role, p, opts))) return forbidden()
  return role
}

// Boolean form for conditional logic (e.g. filtering sale-price rows in GETs).
export async function isOwnerCurrentUser(): Promise<boolean> {
  const role = await getRole()
  return isOwnerRole(role)
}
