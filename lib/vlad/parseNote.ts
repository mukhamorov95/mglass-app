import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

// Разбор надиктовки владельца: свободная речь → структурированные элементы.
// Каждый элемент — задача/решение/обдумать/обязательство, с ролью, сроком,
// контактом и шагами. Модель НИЧЕГО не придумывает сверх сказанного.

export type ParsedItem = {
  role: 'ceo' | 'manager' | 'cfo' | 'production' | 'father' | 'husband' | 'son' | 'brother' | 'other'
  kind: 'task' | 'decide' | 'think' | 'commitment'
  title: string
  details: string | null
  due_date: string | null
  contact: string | null
  steps: string[]
}

const ROLES = ['ceo', 'manager', 'cfo', 'production', 'father', 'husband', 'son', 'brother', 'other']
const KINDS = ['task', 'decide', 'think', 'commitment']

const SYSTEM = `Ты — личный ассистент Владислава, владельца стекольной компании M-Glass.
Он надиктовывает мысли на ходу: задачи, проблемы, обязательства — вперемешку, без структуры.
Твоя работа: разложить сказанное на отдельные элементы. СТРОГО JSON-массив, без комментариев.

Каждый элемент:
{
 "role": одна из ролей — "ceo" (стратегия, компания в целом), "manager" (продажи, клиенты),
   "cfo" (деньги, кредиты, платежи), "production" (цех, заказы, доставки),
   "father" | "husband" | "son" | "brother" (семья — по контексту), "other",
 "kind": "task" (сделать), "decide" (принять решение), "think" (обдумать), "commitment" (обещал кому-то),
 "title": выжимка одной короткой фразой, по-русски, с большой буквы,
 "details": подробности из сказанного своими словами Владислава, или null,
 "due_date": "YYYY-MM-DD" если срок прозвучал (сегодня ${'{TODAY}'}, пересчитай «до пятницы», «через неделю», «до 25-го» в дату), иначе null,
 "contact": с кем нужно скоммуницировать, если прозвучало имя/роль, иначе null,
 "steps": если есть срок или задача сложная — 2-5 конкретных шагов, иначе []
}

Правила:
- Не выдумывай ничего, чего не было в речи. Шаги — только очевидные из контекста.
- Один элемент = одна мысль. Если в речи три разных дела — три элемента.
- Речь расшифрована автоматически: могут быть ослышки, восстанавливай смысл по контексту.
- Если это просто эмоция/наблюдение без действия — kind "think", role по контексту.`

export async function parseNote(transcript: string, todayISO: string): Promise<ParsedItem[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    system: SYSTEM.replace('{TODAY}', todayISO),
    messages: [{ role: 'user', content: transcript }],
  })
  const text = msg.content.find(b => b.type === 'text')?.text ?? '[]'
  const jsonStr = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)
  let raw: unknown
  try { raw = JSON.parse(jsonStr) } catch { throw new Error('AI вернул не-JSON: ' + text.slice(0, 120)) }
  if (!Array.isArray(raw)) throw new Error('AI вернул не массив')

  return raw.flatMap((r): ParsedItem[] => {
    const o = r as Record<string, unknown>
    const title = String(o.title ?? '').trim()
    if (!title) return []
    return [{
      role: ROLES.includes(String(o.role)) ? (o.role as ParsedItem['role']) : 'other',
      kind: KINDS.includes(String(o.kind)) ? (o.kind as ParsedItem['kind']) : 'task',
      title: title.slice(0, 200),
      details: o.details ? String(o.details) : null,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.due_date ?? '')) ? String(o.due_date) : null,
      contact: o.contact ? String(o.contact) : null,
      steps: Array.isArray(o.steps) ? o.steps.map(s => String(s)).filter(Boolean).slice(0, 8) : [],
    }]
  })
}

// Пересборка выжимки задачи после дополнения деталей новой надиктовкой
export async function resummarize(title: string, details: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Задача сейчас называется: «${title}»\nПолные детали:\n${details}\n\nВерни ОДНУ короткую фразу-выжимку (до 12 слов, по-русски) — о чём эта задача с учётом всех деталей. Только фразу, без кавычек и пояснений.`,
    }],
  })
  const t = msg.content.find(b => b.type === 'text')?.text?.trim()
  return t ? t.slice(0, 200) : title
}
