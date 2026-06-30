import { NextResponse } from 'next/server'
import { getRole, isOwnerRole, type Role } from './getRole'

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

// Boolean form for conditional logic (e.g. filtering sale-price rows in GETs).
export async function isOwnerCurrentUser(): Promise<boolean> {
  const role = await getRole()
  return isOwnerRole(role)
}
