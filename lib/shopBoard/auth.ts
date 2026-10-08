import 'server-only'
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser, getUserProfile, type Role } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { STAFF_ROLES } from './model'
import { loadActor, type BoardActor } from './server'

// Ворота табло для API: сначала роль сотрудника (партнёр, замерщик, аноним — 403),
// потом service-role и имя для журнала. Права на конкретное действие — в server.ts.
export async function boardGate(): Promise<{ svc: ReturnType<typeof createServiceClient>; actor: BoardActor } | NextResponse> {
  const guard = await requireRole([...STAFF_ROLES] as Role[])
  if (guard instanceof NextResponse) return guard
  const [user, profile] = await Promise.all([getSessionUser(), getUserProfile()])
  if (!user || !profile) return NextResponse.json({ error: 'Нужен вход' }, { status: 401 })
  const svc = createServiceClient()
  const actor = await loadActor(svc, user.id, profile.role, profile.permissions ?? null)
  return { svc, actor }
}
