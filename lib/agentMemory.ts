import { createClient } from '@supabase/supabase-js'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'skip' | 'idle'

const LEVEL_ICONS: Record<LogLevel, string> = {
  success: '✅',
  info:    'ℹ️',
  warn:    '⚠️',
  error:   '❌',
  skip:    '⏭',
  idle:    '😴',
}

/** Читает память агента из БД */
export async function readMemory<T extends Record<string, unknown>>(agentKey: string): Promise<T> {
  const supabase = db()
  const { data } = await supabase
    .from('agent_settings')
    .select('memory')
    .eq('agent_key', agentKey)
    .single()
  return ((data?.memory ?? {}) as T)
}

/** Записывает память агента (merge с существующей) */
export async function writeMemory(agentKey: string, patch: Record<string, unknown>): Promise<void> {
  const supabase = db()
  const current = await readMemory(agentKey)
  await supabase
    .from('agent_settings')
    .update({ memory: { ...current, ...patch }, updated_at: new Date().toISOString() })
    .eq('agent_key', agentKey)
}

/** Пишет строку в лог агента */
export async function writeLog(
  agentKey: string,
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const supabase = db()
  await supabase.from('agent_logs').insert({
    agent_key: agentKey,
    level,
    icon:      LEVEL_ICONS[level],
    message,
    meta:      meta ?? null,
    ran_at:    new Date().toISOString(),
  })
}

/** Обновляет статистику запуска (last_action_text, total_runs, last_run_at, is_running) */
export async function startRun(agentKey: string): Promise<boolean> {
  const supabase = db()
  // Проверяем что агент включён
  const { data } = await supabase
    .from('agent_settings')
    .select('enabled, is_running')
    .eq('agent_key', agentKey)
    .single()
  if (!data?.enabled) return false
  await supabase
    .from('agent_settings')
    .update({ is_running: true, updated_at: new Date().toISOString() })
    .eq('agent_key', agentKey)
  return true
}

export async function finishRun(agentKey: string, lastActionText: string): Promise<void> {
  const supabase = db()
  await supabase
    .from('agent_settings')
    .update({
      is_running:       false,
      last_run_at:      new Date().toISOString(),
      last_action_text: lastActionText,
      updated_at:       new Date().toISOString(),
    })
    .eq('agent_key', agentKey)
  // Инкремент total_runs через rpc или read+write
  const { data } = await supabase
    .from('agent_settings')
    .select('total_runs')
    .eq('agent_key', agentKey)
    .single()
  await supabase
    .from('agent_settings')
    .update({ total_runs: ((data?.total_runs ?? 0) as number) + 1 })
    .eq('agent_key', agentKey)
}

export async function failRun(agentKey: string, error: string): Promise<void> {
  const supabase = db()
  await supabase
    .from('agent_settings')
    .update({ is_running: false, last_action_text: `❌ Ошибка: ${error}`, updated_at: new Date().toISOString() })
    .eq('agent_key', agentKey)
  await writeLog(agentKey, 'error', error)
}
