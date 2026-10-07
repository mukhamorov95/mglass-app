import 'server-only'
import { createClient } from './supabase-server'
import { createServiceClient } from './supabase-service'

export type LogAction =
  | 'user.update'
  | 'user.permission_change'
  | 'user.password_change'
  | 'order.create'
  | 'order.update'
  | 'order.delete'
  | 'order.status_change'
  | 'order.price_change'
  | 'order.discount_given'
  | 'quote.create'
  | 'quote.update'
  | 'quote.delete'
  | 'calculation.create'
  | 'calculation.update'
  | 'pdf.download'
  | 'upd.issue'
  | 'upd.series_set'

// Автор — только из проверенной сессии: функции, которой можно передать чужой user_id,
// больше нет. Пишет service-role, потому что у ролей пользователей прав на запись в
// журнал нет (миграция 20261001_activity_log_owner_read_server_write) — иначе любой
// вошедший дописал бы в него что угодно напрямую через PostgREST.
// Сбой записи не ломает основное действие, но и не молчит: до 01.10.2026 каждую запись
// отбивал RLS, ошибку никто не читал, и журнал оставался пустым.
export async function writeLogForCurrentUser(
  action: LogAction,
  opts?: { entityType?: string; entityId?: string; details?: Record<string, unknown> },
): Promise<void> {
  try {
    const sb = await createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) {
      console.error('[activityLog] нет сессии, запись пропущена:', action)
      return
    }

    const db = createServiceClient()
    const { data: profile, error: profileErr } = await db
      .from('users')
      .select('name, email')
      .eq('id', user.id)
      .maybeSingle()
    if (profileErr) console.error('[activityLog] не прочитать имя автора:', profileErr.message)

    const { error } = await db.from('activity_log').insert({
      user_id:     user.id,
      user_name:   profile?.name ?? profile?.email ?? user.email ?? null,
      action,
      entity_type: opts?.entityType ?? null,
      entity_id:   opts?.entityId ?? null,
      details:     opts?.details ?? null,
    })
    if (error) console.error('[activityLog] запись не прошла:', error.message, { action, entityType: opts?.entityType })
  } catch (e) {
    console.error('[activityLog] запись не прошла:', e instanceof Error ? e.message : e, { action })
  }
}
