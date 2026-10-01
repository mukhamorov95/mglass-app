import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isOwnerRole } from '@/lib/getRole'

// «Смотреть как партнёр» (решение владельца 01.10.2026): владелец открывает кабинет глазами
// любого партнёра без его пароля. Кука хранит только id клиента, и действует она лишь у
// владельца (admin/ceo по public.users) — у партнёра или менеджера с такой кукой ничего не
// меняется. В режиме просмотра кабинет только читает: от имени партнёра ничего не пишется.
// Исключение — тестовая карточка (b2b_clients.is_test): на ней можно править настройки прилавка.

export const PREVIEW_COOKIE = 'pcab_preview'
export const PREVIEW_MAX_AGE = 8 * 3600

export async function previewClientId(svc: SupabaseClient, userId: string): Promise<number | null> {
  let raw: string | undefined
  try { raw = (await cookies()).get(PREVIEW_COOKIE)?.value } catch { return null }
  const id = Number(raw)
  if (!raw || !Number.isInteger(id) || id <= 0) return null
  const { data } = await svc.from('users').select('role').eq('id', userId).maybeSingle()
  return isOwnerRole((data as { role?: string } | null)?.role) ? id : null
}

// Для маршрутов, которые пишут: в режиме просмотра — 403 с понятной причиной.
export async function previewWriteGuard(svc: SupabaseClient, userId: string, opts: { allowOnTest?: boolean } = {}): Promise<NextResponse | null> {
  const id = await previewClientId(svc, userId)
  if (id == null) return null
  if (opts.allowOnTest) {
    const { data } = await svc.from('b2b_clients').select('is_test').eq('id', id).maybeSingle()
    if ((data as { is_test?: boolean } | null)?.is_test === true) return null
  }
  return NextResponse.json({ error: 'Режим просмотра: от имени партнёра ничего не сохраняется' }, { status: 403 })
}
