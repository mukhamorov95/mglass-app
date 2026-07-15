// Классификатор входящих диалогов Авито для импорта в CRM.
// Решает: interested (добавить) / refused (пропустить) / unclear (пусто), и снимает
// данные клиента. Дешёвая модель (Haiku) — вызовов много при пакетном импорте.

import Anthropic from '@anthropic-ai/sdk'
import { type DialogMsg, type LeadKnown } from './avitoManagerRuntime'

export type LeadStatus = 'interested' | 'refused' | 'unclear'
export type ClassifiedLead = {
  status: LeadStatus
  reason: string
  extracted: LeadKnown
  score: number
}

const SYSTEM = `Ты классификатор входящих диалогов Авито для компании M-Glass (Москва): собственное производство зеркал, душевых перегородок и лофт-перегородок из стекла.

Реши по переписке, добавлять ли диалог в CRM как заявку:
- interested — клиент интересуется НАШИМ продуктом (спрашивает цену/размеры/замер), либо диалог оборвался на нашей стороне (мы не ответили клиенту). ВАЖНО: «дорого» — НЕ отказ (у нас есть эконом-вариант).
- refused — клиент ЯВНО отказался («не интересно», «уже купил/заказал», «передумал», «спасибо, не надо»), ЛИБО это не наш профиль (автостёкла, ремонт стеклопакетов, мебель без стекла), ЛИБО спам/нерелевант.
- unclear — не хватает информации (пустой чат, одно слово, только «здравствуйте»).

Сними данные клиента, какие видно (имя, продукт, размеры, город, бюджет, телефон). score 0–100 — насколько «горячий» (есть продукт+размеры+готовность = высокий).`

const TOOL: Anthropic.Tool = {
  name: 'classify',
  description: 'Классификация диалога Авито и снятые данные клиента',
  input_schema: {
    type: 'object' as const,
    properties: {
      status: { type: 'string', enum: ['interested', 'refused', 'unclear'] },
      reason: { type: 'string', description: 'Короткая причина решения (одна фраза)' },
      extracted: {
        type: 'object',
        properties: {
          name: { type: ['string', 'null'] }, product: { type: ['string', 'null'] },
          sizes: { type: ['string', 'null'] }, city: { type: ['string', 'null'] },
          budget: { type: ['string', 'null'] }, phone: { type: ['string', 'null'] },
        },
      },
      score: { type: 'number' },
    },
    required: ['status', 'reason', 'extracted', 'score'],
  },
}

export async function classifyAvitoDialog(history: DialogMsg[]): Promise<ClassifiedLead> {
  // Пустой/односложный диалог — не тратим токены
  const clientText = history.filter(m => m.from === 'client').map(m => m.text).join(' ').trim()
  if (clientText.length < 3) {
    return { status: 'unclear', reason: 'пустой диалог', extracted: {}, score: 0 }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const transcript = history.map(m => `${m.from === 'client' ? 'КЛИЕНТ' : 'МЫ'}: ${m.text}`).join('\n')

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'classify' },
    messages: [{ role: 'user', content: `Диалог:\n${transcript}` }],
  })

  const tu = res.content.find(c => c.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  const input = (tu?.input ?? {}) as Partial<ClassifiedLead>
  return {
    status: (input.status as LeadStatus) ?? 'unclear',
    reason: input.reason ?? '',
    extracted: input.extracted ?? {},
    score: Math.max(0, Math.min(100, Math.round(input.score ?? 0))),
  }
}
