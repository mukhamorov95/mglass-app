// База знаний AI и компании: таблицы ai_knowledge (что знаем) и ai_knowledge_gaps
// (чего бот не знает). Экран — /ai/knowledge, читатель — бот Авито.
// Чтение fail-open: база недоступна → бот работает без фактов и отвечает «уточню»,
// а не выдумывает.

import type { SupabaseClient } from '@supabase/supabase-js'

export const KNOWLEDGE_CATEGORIES = [
  { key: 'company',     label: 'О компании',          hint: 'кто мы, чем занимаемся и чем нет, география' },
  { key: 'products',    label: 'Изделия',             hint: 'стекло, толщины, фурнитура, подсветка, что из чего' },
  { key: 'process',     label: 'Замер, сроки, монтаж', hint: 'как проходит замер, сроки изготовления и монтажа' },
  { key: 'pricing',     label: 'Цены и условия',      hint: 'оплата, предоплата, скидки, доставка' },
  { key: 'guarantee',   label: 'Гарантия и сервис',   hint: 'гарантийный срок, что покрывает, рекламации' },
  { key: 'objections',  label: 'Возражения',          hint: '«дорого», «подумаю», «у других дешевле»' },
  { key: 'competitors', label: 'Конкуренты',          hint: 'чем мы отличаемся' },
  { key: 'b2b',         label: 'Дизайнерам и B2B',    hint: 'условия для дизайнеров, прорабов, партнёров' },
] as const

export type KnowledgeCategory = typeof KNOWLEDGE_CATEGORIES[number]['key']

export type KnowledgeItem = {
  id: number
  category: KnowledgeCategory
  title: string
  content: string
  for_bot: boolean
  active: boolean
  sort_order: number
  updated_at: string
  updated_by: string | null
}

export type KnowledgeGap = {
  id: number
  question: string
  source: string
  lead_id: number | null
  status: 'open' | 'answered' | 'dismissed'
  created_at: string
}

export function isKnowledgeCategory(v: unknown): v is KnowledgeCategory {
  return KNOWLEDGE_CATEGORIES.some(c => c.key === v)
}

// Потолок блока в промпте: база растёт, а каждый символ едет в каждый ответ бота.
const BOT_BLOCK_LIMIT = 12000

export function formatKnowledgeForBot(items: Pick<KnowledgeItem, 'category' | 'title' | 'content'>[]): string {
  if (!items.length) return ''
  const parts: string[] = []
  let size = 0
  for (const cat of KNOWLEDGE_CATEGORIES) {
    const rows = items.filter(i => i.category === cat.key)
    if (!rows.length) continue
    const section = `## ${cat.label}\n` + rows.map(r => `- ${r.title}: ${r.content.trim()}`).join('\n')
    if (size + section.length > BOT_BLOCK_LIMIT) break
    parts.push(section)
    size += section.length
  }
  return parts.join('\n\n')
}

// Вебхук вызывается на каждое сообщение клиента — держим базу в памяти минуту.
// Правка на экране доходит до бота не позже чем через 60 секунд.
let memo: { at: number; text: string } | null = null
const MEMO_MS = 60_000

export async function loadBotKnowledge(service: SupabaseClient): Promise<string> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.text
  try {
    const { data, error } = await service.from('ai_knowledge')
      .select('category,title,content')
      .eq('active', true).eq('for_bot', true)
      .order('category').order('sort_order').order('id')
    if (error) return memo?.text ?? ''
    const text = formatKnowledgeForBot((data ?? []) as KnowledgeItem[])
    memo = { at: Date.now(), text }
    return text
  } catch {
    return memo?.text ?? ''
  }
}

// Суммы, записанные владельцем в базу, — утверждённые: страж цен бота не должен
// вырезать их из ответа (иначе «доставка 5000 ₽» из базы превратится в «уточню»).
export function knowledgeAmounts(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/(\d[\d  ]*\d|\d)\s*(?:₽|руб)/g)) {
    const n = Number(m[1].replace(/[^\d]/g, ''))
    if (n > 0) out.push(n)
  }
  return out
}

export function normalizeGapQuestion(q: string): string {
  return q.replace(/\s+/g, ' ').trim().slice(0, 300)
}

// Один и тот же вопрос в одном чате пишем один раз: бот видит всю историю и
// на каждом ходе может заново отметить тот же пробел.
export async function recordKnowledgeGap(
  service: SupabaseClient,
  gap: { question: string; leadId?: number | null; source?: string },
): Promise<void> {
  const question = normalizeGapQuestion(gap.question)
  if (question.length < 3) return
  try {
    let dup = service.from('ai_knowledge_gaps').select('id').eq('status', 'open').eq('question', question).limit(1)
    dup = gap.leadId != null ? dup.eq('lead_id', gap.leadId) : dup.is('lead_id', null)
    const { data } = await dup
    if (data && data.length) return
    await service.from('ai_knowledge_gaps').insert({ question, lead_id: gap.leadId ?? null, source: gap.source ?? 'avito' })
  } catch { /* пробел не записался — ответ клиенту важнее */ }
}
