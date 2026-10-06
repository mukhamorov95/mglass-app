// Рекомендации AI Control Center: генерация по живым данным и решения владельца.
// Одна функция для кнопки на экране и для ежедневного крона — чтобы они не разошлись.

import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { KNOWLEDGE_CATEGORIES, loadBotKnowledge } from '@/lib/knowledge/aiKnowledge'
import { collectFacts } from './recFacts'
import { pickEvidence, unverifiedNumbers } from './recEvidence'
import { DEFAULT_OWNER_DECISIONS, DEFAULT_SYSTEM_FACTS, OWNER_DECISIONS_KEY, SYSTEM_FACTS_KEY } from './systemFacts'

import { PERSPECTIVES, factLine, type RecEvidence, type RecStatus, type RecPriority, type Recommendation } from './recommendationTypes'

export type { RecStatus, RecPriority, Recommendation }

const PERSPECTIVE_FOCUS: Record<string, string> = {
  ceo: 'выручка, маржа, риски и то, что сильнее всего двигает деньги в ближайший месяц',
  sales: 'заявки с Авито и сайта, скорость реакции, передача клиента менеджеру, конверсия в замер и оплату',
  analyst: 'качество данных, пробелы в учёте, то, что мешает измерять результат',
  erp: 'производство, закупки, склад, сроки и срывы',
  marketing: 'каналы заявок, стоимость клиента, контент и видимость',
}

const PRIORITIES: RecPriority[] = ['critical', 'high', 'medium', 'low']

// Крон дня недели → перспектива: за неделю бизнес осматривается со всех сторон.
export function perspectiveForDay(date = new Date()): string {
  return PERSPECTIVES[date.getUTCDay() % PERSPECTIVES.length].id
}

const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

// Не цифры, а контекст: чего не знает бот, пустые разделы базы знаний, цели из анкеты
// владельца (до 06.10 в модель уходила одна строка анкеты из шестнадцати) и справка
// о системе — она правится на странице, а не в коде.
async function collectContext(sb: SupabaseClient) {
  const [gaps, knowledge, strategy] = await Promise.all([
    sb.from('ai_knowledge_gaps').select('question').eq('status', 'open').gte('created_at', since(60)).order('created_at', { ascending: false }).limit(10),
    sb.from('ai_knowledge').select('category').eq('active', true),
    sb.from('owner_strategy').select('key, value'),
  ])
  const filled = new Set(((knowledge.data ?? []) as { category: string }[]).map(k => k.category))
  const kv = new Map(((strategy.data ?? []) as { key: string; value: string | null }[]).map(r => [r.key, (r.value ?? '').trim()]))
  return {
    knowledgeEmpty: KNOWLEDGE_CATEGORIES.filter(c => !filled.has(c.key)).map(c => c.label),
    botUnanswered: ((gaps.data ?? []) as { question: string }[]).map(g => g.question),
    ownerGoals: Object.fromEntries([...kv].filter(([k, v]) => v && !k.startsWith('ai_'))),
    systemFacts: kv.get(SYSTEM_FACTS_KEY) || DEFAULT_SYSTEM_FACTS,
    ownerDecisions: kv.get(OWNER_DECISIONS_KEY) || DEFAULT_OWNER_DECISIONS,
  }
}

type Draft = { title: string; priority: string; category: string; problem: string; impact: string; action: string; metric: string; evidence?: unknown; check?: unknown }

export async function generateRecommendations(
  sb: SupabaseClient,
  opts: { perspective: string; count?: number; source: 'ai' | 'cron' },
): Promise<Recommendation[]> {
  const perspective = PERSPECTIVE_FOCUS[opts.perspective] ? opts.perspective : 'ceo'
  const count = Math.min(7, Math.max(1, opts.count ?? 5))
  const [context, knowledge, { facts, missing }] = await Promise.all([collectContext(sb), loadBotKnowledge(sb), collectFacts(sb)])
  if (!facts.length) throw new Error(`Нет данных для анализа: ${missing.join('; ') || 'ни один источник не ответил'}`)
  const byId = new Map(facts.map(f => [f.id, f]))

  // Прошлые решения владельца — чтобы не предлагать убранное и архивное повторно,
  // и понимать, какого рода советы он берёт в работу.
  const { data: history } = await sb.from('ai_recommendations')
    .select('title, status').order('created_at', { ascending: false }).limit(150)
  const past = (history ?? []) as { title: string; status: RecStatus }[]
  const byStatus = (s: RecStatus[]) => past.filter(p => s.includes(p.status)).map(p => `- ${p.title}`).join('\n') || '—'

  const prompt = `Ты — консультант компании M-Glass (Москва, собственное производство зеркал, стеклянных душевых и перегородок; розница через Авито и сайт, B2B — стекло для партнёров). Смотришь на бизнес с позиции: ${PERSPECTIVE_FOCUS[perspective]}.

УЖЕ ЕСТЬ В СИСТЕМЕ (не советуй это строить):
${context.systemFacts}

РЕШЕНИЯ ВЛАДЕЛЬЦА (не предлагай обратное):
${context.ownerDecisions}

ЦЕЛИ И ПАРАМЕТРЫ ИЗ АНКЕТЫ ВЛАДЕЛЬЦА:
${JSON.stringify(context.ownerGoals, null, 2)}

ФАКТЫ КОМПАНИИ ИЗ БАЗЫ ЗНАНИЙ (истина — не противоречь им: цены, условия, замер):
${knowledge || '(база пуста)'}

ЦИФРЫ — посчитаны кодом из учёта, формат «[id] показатель: значение (период) — источник»:
${facts.map(f => `[${f.id}] ${factLine(f)} — ${f.source}`).join('\n')}
${missing.length ? `\nНЕТ ДАННЫХ (источник не ответил — не делай выводов об этом): ${missing.join('; ')}\n` : ''}
Как читать цифры:
- «Продажи M-Glass» — розница по дате продажи; B2B считается отдельно, по дате запуска в работу.
- Оплаты месяца у менеджера идут и по замерам прошлых месяцев: делить оплаты на замеры того же месяца нельзя.
- Отгрузка B2B со сроком больше 14 дней назад почти всегда отгружена без отметки — это вопрос учёта, а не срыв.
- Влад — владелец, Дима — руководитель продаж: заявки ведут не они.

ДРУГОЕ:
Пустые разделы базы знаний бота: ${context.knowledgeEmpty.join(', ') || 'нет'}
Вопросы, на которые бот не знал ответа: ${context.botUnanswered.join(' | ') || 'нет'}

ПРОШЛЫЕ РЕКОМЕНДАЦИИ И РЕШЕНИЯ ВЛАДЕЛЬЦА:
Взяты в работу или сделаны (такие ему полезны):
${byStatus(['in_work', 'done'])}
Отправлены в архив или убраны (НЕ предлагай их снова, даже другими словами):
${byStatus(['archived', 'removed'])}
Ещё без решения (не дублируй):
${byStatus(['new'])}

ЗАДАЧА: дай ${count} рекомендаций, каждая направлена на измеримый результат.
- Каждая опирается на цифры выше: в evidence — их id (от 1 до 4), ровно как в квадратных скобках. Рекомендация без опоры на цифры не принимается.
- Числа в problem — только из цифр выше или их простые доли и изменения. Своих оценок не пиши.
- check — id цифры из evidence, по которой через месяц видно, сработало ли.
- Никаких общих слов вроде «улучшить UX» или «внедрить аналитику». Конкретное действие, которое можно начать на этой неделе.
- Не утверждай, что в системе чего-то нет, если этого просто нет в цифрах: пиши «в данных для анализа не видно X».
- metric — чем проверить результат и через сколько: «средний чек розницы со 127 263 ₽ до 140 000 ₽ за 30 дней».

Ответ — ТОЛЬКО JSON-массив без markdown:
[{"title":"до 70 символов","priority":"critical|high|medium|low","category":"Продажи|Финансы|Производство|Данные|Маркетинг|AI|Риск","problem":"что не так, одно предложение с цифрой","impact":"чем это стоит бизнесу","action":"конкретное действие, одно-два предложения","metric":"как и когда проверить результат","evidence":["id"],"check":"id"}]`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const res = await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = res.content.find(c => c.type === 'text')
  const text = block?.type === 'text' ? block.text : '[]'

  let drafts: Draft[] = []
  try {
    drafts = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
  } catch {
    throw new Error(`AI вернул ответ не в формате списка рекомендаций (stop_reason ${res.stop_reason}, ${res.usage.output_tokens} токенов): …${text.slice(-200)}`)
  }

  const known = new Set(past.map(p => normTitle(p.title)))
  const rows = drafts
    .filter(d => d && typeof d.title === 'string' && d.title.trim() && !known.has(normTitle(d.title)))
    .map(d => ({ d, evidence: pickEvidence(d.evidence, d.check, byId) }))
    // Без опоры на цифры — не рекомендация, а мнение: такие не сохраняем.
    .filter((x): x is { d: Draft; evidence: RecEvidence } => x.evidence != null)
    .slice(0, count)
    .map(({ d, evidence }) => ({
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
      evidence: { ...evidence, unverified: unverifiedNumbers(d.problem, facts) },
    }))
  if (!rows.length) return []
  return insertRecommendations(sb, rows)
}

// Колонка evidence появляется после SQL владельца (20261006_ai_recommendations_evidence.sql).
// До него рекомендации сохраняются как раньше, без цифр: анализ не встаёт из-за схемы.
async function insertRecommendations(sb: SupabaseClient, rows: Record<string, unknown>[]): Promise<Recommendation[]> {
  const first = await sb.from('ai_recommendations').insert(rows).select('*')
  if (!first.error) return (first.data ?? []) as Recommendation[]
  if (!/evidence/.test(first.error.message)) throw new Error(first.error.message)
  // Ключ убираем, а не обнуляем: supabase-js строит список колонок по ключам строк.
  const bare = rows.map(r => { const c = { ...r }; delete c.evidence; return c })
  const retry = await sb.from('ai_recommendations').insert(bare).select('*')
  if (retry.error) throw new Error(retry.error.message)
  return (retry.data ?? []) as Recommendation[]
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

export function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim()
}
