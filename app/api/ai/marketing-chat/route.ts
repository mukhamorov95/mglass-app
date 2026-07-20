import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { createClient } from '@/lib/supabase-server'
import { MARKETING_SYSTEM_PROMPT } from '@/lib/marketingManagerPrompt'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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
        const apiStream = anthropic.messages.stream({
          model: 'claude-sonnet-5',
          max_tokens: 4096,
          system: MARKETING_SYSTEM_PROMPT,
          messages,
        })

        apiStream.on('text', (textDelta) => send({ type: 'text', text: textDelta }))
        await apiStream.finalMessage()
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : 'Ошибка сервера' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
