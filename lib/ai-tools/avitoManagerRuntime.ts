// AI-менеджер Авито: ведёт диалог как живой менеджер M-Glass, снимает данные,
// квалифицирует лид и просит расчёт у ДЕТЕРМИНИРОВАННОГО quickCalc (модель цен
// не считает — только вставляет готовую цифру). Один вызов модели на сообщение.
//
// SAFE PROFILE: пишет только через вызывающий код (webhook/simulate);
// external HTTP — только Anthropic API; цены — исключительно из lib/quickCalc.

import Anthropic from '@anthropic-ai/sdk'
import { quickCalc, type CalcType } from '@/lib/quickCalc'

export type DialogMsg = { from: 'client' | 'manager'; text: string }

export type LeadKnown = {
  name?: string | null
  product?: string | null
  sizes?: string | null
  city?: string | null
  budget?: string | null
  phone?: string | null
}

export type ManagerTurn = {
  reply: string
  extracted: LeadKnown
  est_amount: number | null
  qualified: boolean
  score: number
  score_reason: string
  needs_human: boolean
}

const PERSONA = `Ты — Максим, менеджер компании M-Glass (Москва): собственное производство зеркал, душевых перегородок из стекла и лофт-перегородок. Ты общаешься с клиентом в чате Авито.

КАК ТЫ ПИШЕШЬ:
- Живо и по-человечески, цельными фразами, без канцелярита и без роботных шаблонов. Никаких «Ваше обращение очень важно для нас».
- Коротко, но содержательно: 2–4 предложения. Не больше ДВУХ вопросов за сообщение.
- Без смайликов-фейерверков (максимум один уместный), без КАПСА, без давления.
- Всегда двигаешь разговор к результату: размеры → цена → замер.

ЧТО ТЫ ДЕЛАЕШЬ:
1. Выясняешь: что за изделие (зеркало / душевая / лофт-перегородка / просто стекло), размеры хотя бы примерно, город.
2. Как только известны тип и размеры — ЗАПРАШИВАЕШЬ расчёт (поле calc), и в reply ставишь метку {{PRICE}} там, где должна стоять цена. Пример: «По вашим размерам выходит примерно {{PRICE}} — это с закалённым стеклом и фурнитурой». НИКОГДА не называй цену из головы — только {{PRICE}}.
3. Если цена устроила и размеры чистовые — предлагаешь замер, спрашиваешь удобный день и телефон.
4. Клиент с маленьким бюджетом — НЕ отказ: предложи бюджетный вариант (у нас своё производство, можем дешевле рынка). Помечай в score_reason «эконом».
5. Не наш профиль (автостёкла, ремонт стеклопакетов, мебель на заказ без стекла) — вежливо скажи, что этим не занимаемся, qualified=false.
6. Если клиент злится, требует директора или ситуация нестандартная — needs_human=true, мягко скажи что уточнишь у старшего и вернёшься.

ПРАВИЛА-ГРАНИЦЫ:
- Не обещай сроков производства и монтажа конкретными датами — «обычно 5–7 рабочих дней, точнее скажу после замера».
- Не давай скидок. Не называй себестоимость. Не выдумывай характеристики.
- Город не Москва/МО — уточни, возим ли туда (qualified оставь true, needs_human=true).

КВАЛИФИКАЦИЯ (qualified=true — «наш клиент, работаем»):
- Понятен продукт нашего профиля + есть контакт или клиент активно идёт к сделке.
- score 0–100: 80+ горячий (размеры есть, цена ок, готов к замеру), 50–79 тёплый, <50 холодный/нецелевой. score_reason — одна фраза почему.`

const RESPOND_TOOL: Anthropic.Tool = {
  name: 'respond',
  description: 'Ответ менеджера и снятые с диалога данные',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: { type: 'string', description: 'Текст ответа клиенту. Если нужен расчёт — с меткой {{PRICE}}' },
      extracted: {
        type: 'object',
        properties: {
          name: { type: ['string', 'null'] }, product: { type: ['string', 'null'] },
          sizes: { type: ['string', 'null'] }, city: { type: ['string', 'null'] },
          budget: { type: ['string', 'null'] }, phone: { type: ['string', 'null'] },
        },
      },
      calc: {
        type: ['object', 'null'],
        description: 'Заполни, когда известны тип и размеры в мм — система посчитает цену',
        properties: {
          type: { type: 'string', enum: ['mirror', 'shower', 'loft'] },
          width: { type: 'number' }, height: { type: 'number' },
          budgetTier: { type: 'boolean', description: 'true для эконом-варианта' },
        },
        required: ['type', 'width', 'height'],
      },
      qualified: { type: 'boolean' },
      score: { type: 'number' },
      score_reason: { type: 'string' },
      needs_human: { type: 'boolean' },
    },
    required: ['reply', 'extracted', 'qualified', 'score', 'score_reason', 'needs_human'],
  },
}

export async function runAvitoManager(history: DialogMsg[], known: LeadKnown): Promise<ManagerTurn> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const knownLines = Object.entries(known).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
  const messages: Anthropic.MessageParam[] = [
    ...(knownLines ? [{ role: 'user' as const, content: `Уже известно о клиенте:\n${knownLines}` },
                      { role: 'assistant' as const, content: 'Принял, учитываю.' }] : []),
    ...history.map(m => ({ role: m.from === 'client' ? 'user' as const : 'assistant' as const, content: m.text })),
  ]

  const res = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1200,
    system: PERSONA,
    tools: [RESPOND_TOOL],
    tool_choice: { type: 'tool', name: 'respond' },
    messages,
  })

  const tu = res.content.find(c => c.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  const input = (tu?.input ?? {}) as {
    reply?: string
    extracted?: LeadKnown
    calc?: { type: CalcType; width: number; height: number; budgetTier?: boolean } | null
    qualified?: boolean
    score?: number
    score_reason?: string
    needs_human?: boolean
  }

  let reply = input.reply ?? 'Секунду, уточню детали и вернусь.'
  let estAmount: number | null = null

  // Цена — только из детерминированного калькулятора
  if (input.calc && reply.includes('{{PRICE}}')) {
    try {
      const r = await quickCalc(input.calc.type, input.calc.width, input.calc.height,
        input.calc.budgetTier ? { tier: 'budget' } : {})
      if (r && r.finalPrice > 0) {
        estAmount = r.finalPrice
        reply = reply.replaceAll('{{PRICE}}', `${Math.round(r.finalPrice).toLocaleString('ru-RU')} ₽`)
      }
    } catch { /* калькулятор недоступен — фолбэк ниже */ }
  }
  reply = reply.replaceAll('{{PRICE}}', 'сейчас уточню у производства и напишу точную цифру')

  return {
    reply,
    extracted: input.extracted ?? {},
    est_amount: estAmount,
    qualified: input.qualified ?? false,
    score: Math.max(0, Math.min(100, Math.round(input.score ?? 0))),
    score_reason: input.score_reason ?? '',
    needs_human: input.needs_human ?? false,
  }
}
