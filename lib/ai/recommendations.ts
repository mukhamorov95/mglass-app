// Рекомендации AI Control Center: генерация по живым данным и решения владельца.
// Одна функция для кнопки на экране и для ежедневного крона — чтобы они не разошлись.

import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { KNOWLEDGE_CATEGORIES, loadBotKnowledge } from '@/lib/knowledge/aiKnowledge'

import { PERSPECTIVES, type RecStatus, type RecPriority, type Recommendation } from './recommendationTypes'

export type { RecStatus, RecPriority, Recommendation }

const PERSPECTIVE_FOCUS: Record<string, string> = {
  ceo: 'выручка, маржа, риски и то, что сильнее всего двигает деньги в ближайший месяц',
  sales: 'заявки с Авито и сайта, скорость реакции, передача клиента менеджеру, конверсия в замер и оплату',
  analyst: 'качество данных, пробелы в учёте, то, что мешает измерять результат',
  erp: 'производство, закупки, склад, сроки и срывы',
  marketing: 'каналы заявок, стоимость клиента, контент и видимость',
}

const PRIORITIES: RecPriority[] = ['critical', 'high', 'medium', 'low']

// Что уже есть в системе и какие решения владелец принял. Без этого модель уверенно
// советует построить то, что давно работает, и то, что владелец запретил (первая
// проверочная порция 17.09: «себестоимости заказа нет», «бесплатный замер», «вилка цен ботом»).
const SYSTEM_FACTS = `УЖЕ ЕСТЬ В СИСТЕМЕ:
- Себестоимость и экономика каждого заказа, маржа, точка безубыточности, ДДС — раздел CFO.
- CRM заявок с Авито, воронка, карточка клиента, задачи менеджерам.
- Бот Авито «Иван»: собирает портрет клиента (изделие, размеры, готовность чистовой отделки, телефон) и сразу передаёт менеджеру. С 17.09 выключен до проверки владельцем.
- База знаний AI и список вопросов, на которые бот не знал ответа (ведётся с 16.09; пустой список при выключенном боте — не поломка).
- Калькуляторы изделий: цену считает код по формуле себестоимость ÷ (1 − маржа − налог 12%).
- Склад, раскрой стекла, производство, B2B-кабинет клиентов.

РЕШЕНИЯ ВЛАДЕЛЬЦА (не предлагай обратное):
- Бот не называет цену клиенту, даже ориентир. Цену считает менеджер.
- AmoCRM — только чтение.
- Факты о компании — только из базы знаний.`

// Крон дня недели → перспектива: за неделю бизнес осматривается со всех сторон.
export function perspectiveForDay(date = new Date()): string {
  return PERSPECTIVES[date.getUTCDay() % PERSPECTIVES.length].id
}

const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

async function safeCount(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  try { const r = await q; return r.error ? null : r.count } catch { return null }
}

async function collectContext(sb: SupabaseClient) {
  const [leads30, leadsQualified, leadsLost, leadsMeasure, calcs30, b2b30, gaps, knowledge, strategy] = await Promise.all([
    safeCount(sb.from('crm_leads').select('id', { count: 'exact', head: true }).gte('created_at', since(30))),
    safeCount(sb.from('crm_leads').select('id', { count: 'exact', head: true }).gte('created_at', since(30)).eq('qualified', true)),
    safeCount(sb.from('crm_leads').select('id', { count: 'exact', head: true }).gte('created_at', since(30)).eq('status', 'lost')),
    safeCount(sb.from('crm_leads').select('id', { count: 'exact', head: true }).gte('created_at', since(30)).eq('stage', 'Замер назначен')),
    safeCount(sb.from('calculations').select('id', { count: 'exact', head: true }).gte('created_at', since(30))),
    safeCount(sb.from('b2b_orders').select('id', { count: 'exact', head: true }).gte('created_at', since(30))),
    sb.from('ai_knowledge_gaps').select('question').eq('status', 'open').order('created_at', { ascending: false }).limit(10),
    sb.from('ai_knowledge').select('category').eq('active', true),
    sb.from('owner_strategy').select('*').limit(1).maybeSingle(),
  ])
  const filled = new Set(((knowledge.data ?? []) as { category: string }[]).map(k => k.category))
  return {
    period: 'последние 30 дней',
    crm_leads: { total: leads30, qualified: leadsQualified, lost: leadsLost, reached_measure: leadsMeasure },
    calculations: calcs30,
    b2b_orders: b2b30,
    knowledge_base_empty_sections: KNOWLEDGE_CATEGORIES.filter(c => !filled.has(c.key)).map(c => c.label),
    questions_bot_could_not_answer: ((gaps.data ?? []) as { question: string }[]).map(g => g.question),
    owner_strategy: strategy.data ?? null,
  }
}

type Draft = { title: string; priority: string; category: string; problem: string; impact: string; action: string; metric: string }

export async function generateRecommendations(
  sb: SupabaseClient,
  opts: { perspective: string; count?: number; source: 'ai' | 'cron' },
): Promise<Recommendation[]> {
  const perspective = PERSPECTIVE_FOCUS[opts.perspective] ? opts.perspective : 'ceo'
  const count = Math.min(7, Math.max(1, opts.count ?? 5))
  const [context, knowledge] = await Promise.all([collectContext(sb), loadBotKnowledge(sb)])

  // Прошлые решения владельца — чтобы не предлагать убранное и архивное повторно,
  // и понимать, какого рода советы он берёт в работу.
  const { data: history } = await sb.from('ai_recommendations')
    .select('title, status').order('created_at', { ascending: false }).limit(150)
  const past = (history ?? []) as { title: string; status: RecStatus }[]
  const byStatus = (s: RecStatus[]) => past.filter(p => s.includes(p.status)).map(p => `- ${p.title}`).join('\n') || '—'

  const prompt = `Ты — консультант компании M-Glass (Москва, собственное производство зеркал, стеклянных душевых и перегородок; продажи через Авито, сайт и B2B). Смотришь на бизнес с позиции: ${PERSPECTIVE_FOCUS[perspective]}.

${SYSTEM_FACTS}

ФАКТЫ КОМПАНИИ ИЗ БАЗЫ ЗНАНИЙ (истина — не противоречь им: цены, условия, замер):
${knowledge || '(база пуста)'}

ДАННЫЕ (${context.period}):
${JSON.stringify(context, null, 2)}

ПРОШЛЫЕ РЕКОМЕНДАЦИИ И РЕШЕНИЯ ВЛАДЕЛЬЦА:
Взяты в работу или сделаны (такие ему полезны):
${byStatus(['in_work', 'done'])}
Отправлены в архив или убраны (НЕ предлагай их снова, даже другими словами):
${byStatus(['archived', 'removed'])}
Ещё без решения (не дублируй):
${byStatus(['new'])}

ЗАДАЧА: дай ${count} рекомендаций, каждая направлена на измеримый результат.
- Опирайся на данные выше; если данных не хватает — рекомендация может быть «начать мерить X», но с понятной пользой.
- Никаких общих слов вроде «улучшить UX» или «внедрить аналитику». Конкретное действие, которое можно начать на этой неделе.
- Не утверждай, что в системе чего-то нет, если этого просто нет в данных выше: пиши «в данных для анализа не видно X». Не советуй строить то, что перечислено в «УЖЕ ЕСТЬ».
- metric — чем проверить результат и через сколько: «доля заявок Авито, дошедших до замера: с 3% до 8% за 30 дней».

Ответ — ТОЛЬКО JSON-массив без markdown:
[{"title":"до 70 символов","priority":"critical|high|medium|low","category":"Продажи|Финансы|Производство|Данные|Маркетинг|AI|Риск","problem":"что не так, одно предложение с цифрой, если есть","impact":"чем это стоит бизнесу","action":"конкретное действие, одно-два предложения","metric":"как и когда проверить результат"}]`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const res = await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = res.content.find(c => c.type === 'text')?.type === 'text'
    ? (res.content.find(c => c.type === 'text') as Anthropic.TextBlock).text : '[]'

  let drafts: Draft[] = []
  try {
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)
    drafts = JSON.parse(json)
  } catch {
    throw new Error('AI вернул ответ не в формате списка рекомендаций')
  }

  const known = new Set(past.map(p => normTitle(p.title)))
  const rows = drafts
    .filter(d => d && typeof d.title === 'string' && d.title.trim() && !known.has(normTitle(d.title)))
    .slice(0, count)
    .map(d => ({
      title: d.title.trim().slice(0, 140),
      priority: PRIORITIES.includes(d.priority as RecPriority) ? d.priority : 'medium',
      category: str(d.category, 40),
      problem: str(d.problem, 600),
      impact: str(d.impact, 600),
      action: str(d.action, 800),
      metric: str(d.metric, 400),
      perspective,
      status: 'new' as const,
      source: opts.source,
    }))
  if (!rows.length) return []
  const { data, error } = await sb.from('ai_recommendations').insert(rows).select('*')
  if (error) throw new Error(error.message)
  return (data ?? []) as Recommendation[]
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

export function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim()
}
