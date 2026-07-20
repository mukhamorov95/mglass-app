import type { SupabaseClient } from '@supabase/supabase-js'

// Kill-switch AI-ботов (Иван в Авито, Владислав в WhatsApp). Переключается
// кнопкой на /vladislav (ai_settings.bot_enabled). До 2026-07-20 флаг писался,
// но ботами не читался — «выключить бота» было невозможно.
export async function isBotEnabled(svc: SupabaseClient): Promise<boolean> {
  try {
    const { data } = await svc.from('ai_settings').select('value').eq('key', 'bot_enabled').maybeSingle()
    // Нет строки/таблицы — бот работает (выключение только явное).
    return (data as { value?: string } | null)?.value !== 'false'
  } catch {
    return true
  }
}
