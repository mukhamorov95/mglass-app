import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages/messages'
import { AI_TOOLS, executeTool } from '@/lib/ai-tools'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM_PROMPT = `Ты — AI-ассистент по продажам компании MGlass.

MGlass производит и устанавливает:
- Зеркала с подсветкой (LED, сенсорные, с пескоструем, разные формы)
- Лофт-перегородки (металлический профиль, стекло, с покраской и без)
- Душевые перегородки (раздвижные, распашные, разные модели стекла)
- Стеклянные конструкции под заказ

Ты помогаешь менеджерам:
1. Отвечать на вопросы клиентов о продуктах, сроках, ценах
2. Составлять и улучшать коммерческие предложения
3. Делать ориентировочные расчёты стоимости
4. Предлагать скрипты, аргументы и ответы на возражения

Финансовая модель:
- Суммарные операционные расходы: ~37% (налоги 12%, менеджер 3%, реализация 3%, маркетинг 5%, транспорт 2%, операционные 12%)
- Дефолтная целевая маржа: 40%, минимально допустимая: 25%
- Формула цены: цена = себестоимость ÷ (1 − расходы − маржа)
- Продажа ниже минимальной маржи требует согласования руководства

Используй инструменты для получения актуальных данных из базы. Отвечай кратко и по делу. Всегда на русском языке.`

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { messages } = await req.json() as { messages: MessageParam[] }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        let currentMessages: MessageParam[] = messages

        // Tool use loop — repeats until no more tool calls
        while (true) {
          const apiStream = anthropic.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            messages: currentMessages,
            tools: AI_TOOLS,
          })

          apiStream.on('text', (textDelta) => send({ type: 'text', text: textDelta }))

          const message = await apiStream.finalMessage()

          if (message.stop_reason !== 'tool_use') break

          const toolUseBlocks = message.content.filter(
            (b): b is ToolUseBlock => b.type === 'tool_use'
          )

          send({ type: 'tool_call', tools: toolUseBlocks.map((t) => t.name) })

          const toolResults = await Promise.all(
            toolUseBlocks.map(async (block) => ({
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: await executeTool(block.name, block.input as Record<string, unknown>),
            }))
          )

          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: message.content },
            { role: 'user', content: toolResults },
          ]
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : 'Ошибка сервера' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
