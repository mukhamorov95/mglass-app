// Ретрив «золотых» ответов менеджеров для few-shot подмешивания в промпт бота.
// Наполняет таблицу ai_manager_examples скрипт scripts/mine-manager-replies.mjs.
// Всё fail-open: любая ошибка/отсутствие таблицы → пустой список, бот работает как прежде.

import type { SupabaseClient } from '@supabase/supabase-js'

export type ManagerExample = {
  id?: number
  product?: string | null
  client_context: string
  manager_reply: string
  won?: boolean | null
  tags?: string[] | null
}

// Простая токенизация RU/EN: слова от 3 символов, нижний регистр.
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-zа-яё0-9]+/gi) ?? []).filter(t => t.length >= 3)
}

/**
 * Чистая, тестируемая функция ранжирования: по пересечению слов контекста клиента
 * с примером + бонус за won (сделка состоялась = ответ сработал). Возвращает top-N.
 */
export function rankExamples(examples: ManagerExample[], clientText: string, limit = 3): ManagerExample[] {
  const q = new Set(tokenize(clientText))
  if (!examples.length || q.size === 0) return []
  return examples
    .map(ex => {
      const ctx = new Set(tokenize(ex.client_context))
      let overlap = 0
      for (const t of q) if (ctx.has(t)) overlap++
      return { ex, score: overlap + (ex.won ? 1.5 : 0) }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.ex)
}

/**
 * Достаёт кандидатов из БД и ранжирует под текущее сообщение клиента.
 * Сначала пробует примеры того же продукта; если пусто — берёт общий пул.
 */
export async function getRelevantExamples(
  db: SupabaseClient,
  opts: { product?: string | null; clientText: string; limit?: number },
): Promise<ManagerExample[]> {
  try {
    if (!opts.clientText || opts.clientText.trim().length < 3) return []
    const cols = 'product,client_context,manager_reply,won,tags'

    let rows: ManagerExample[] = []
    if (opts.product) {
      const { data } = await db.from('ai_manager_examples').select(cols).eq('product', opts.product).limit(120)
      rows = (data ?? []) as ManagerExample[]
    }
    if (rows.length === 0) {
      const { data } = await db.from('ai_manager_examples').select(cols).limit(120)
      rows = (data ?? []) as ManagerExample[]
    }
    return rankExamples(rows, opts.clientText, opts.limit ?? 3)
  } catch {
    return []
  }
}
