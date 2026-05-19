import { createClient } from './supabase-server'

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

export type LogEntry = {
  user_id?:    string | null
  user_name?:  string | null
  action:      LogAction
  entity_type?: string | null
  entity_id?:   string | null
  details?:    Record<string, unknown> | null
}

export async function writeLog(entry: LogEntry): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase.from('activity_log').insert({
      user_id:     entry.user_id ?? null,
      user_name:   entry.user_name ?? null,
      action:      entry.action,
      entity_type: entry.entity_type ?? null,
      entity_id:   entry.entity_id ?? null,
      details:     entry.details ?? null,
    })
  } catch {
    // Log write failure must never break the main flow
  }
}

export async function writeLogForCurrentUser(
  action: LogAction,
  opts?: { entityType?: string; entityId?: string; details?: Record<string, unknown> },
): Promise<void> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', user.id)
      .single()

    await writeLog({
      user_id:     user.id,
      user_name:   profile?.name ?? profile?.email ?? user.email ?? null,
      action,
      entity_type: opts?.entityType,
      entity_id:   opts?.entityId,
      details:     opts?.details,
    })
  } catch {
    // silently swallow
  }
}
