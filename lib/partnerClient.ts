import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { previewClientId } from '@/lib/partnerPreview'
import { PERM_DENIED, can, isTeamRole, type TeamPerm, type TeamRole } from '@/lib/partner/teamRoles'

// Единая точка «какой компании принадлежит этот логин и что ему можно». Fail-closed:
//   1) первичный владелец карточки — b2b_clients.user_id = userId → руководитель;
//   2) сотрудник команды — b2b_client_members.user_id → client_id, роль из строки;
//      отключённый (disabled_at) — нет доступа, проверка на каждом запросе.
// Нет совпадения → null. UNIQUE(user_id) в members: один логин — одна компания.
// Владелец в режиме «Смотреть как партнёр» получает выбранного клиента с правами руководителя.
//
// Все партнёрские эндпоинты резолвят клиента ТОЛЬКО через эти хелперы.

export type PartnerMember<T> = { client: T; role: TeamRole; preview: boolean }

export async function resolvePartnerMember<T = { id: number }>(
  svc: SupabaseClient,
  userId: string,
  cols = 'id',
): Promise<PartnerMember<T> | null> {
  const previewId = await previewClientId(svc, userId)
  if (previewId != null) {
    const { data } = await svc.from('b2b_clients').select(cols).eq('id', previewId).maybeSingle()
    return data ? { client: data as T, role: 'admin', preview: true } : null
  }
  const { data: primary } = await svc.from('b2b_clients').select(cols).eq('user_id', userId).maybeSingle()
  if (primary) return { client: primary as T, role: 'admin', preview: false }

  const { data: member } = await svc.from('b2b_client_members').select('client_id, role, disabled_at').eq('user_id', userId).maybeSingle()
  if (!member || member.disabled_at || !isTeamRole(member.role)) return null
  const { data: client } = await svc.from('b2b_clients').select(cols).eq('id', member.client_id as number).maybeSingle()
  return client ? { client: client as T, role: member.role, preview: false } : null
}

export async function resolvePartnerClient<T = { id: number }>(
  svc: SupabaseClient,
  userId: string,
  cols = 'id',
): Promise<T | null> {
  return (await resolvePartnerMember<T>(svc, userId, cols))?.client ?? null
}

// Право роли: null — можно, иначе готовый 403 с причиной для экрана.
export function denyUnless(role: TeamRole, perm: TeamPerm): NextResponse | null {
  return can(role, perm) ? null : NextResponse.json({ error: PERM_DENIED[perm], perm }, { status: 403 })
}
