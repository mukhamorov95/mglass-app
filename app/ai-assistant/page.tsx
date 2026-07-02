'use client'

import { useEffect, useRef, useState } from 'react'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { PageHeader } from '@/components/ds'

type Message = {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}


const QUICK_PROMPTS = [
  'Сколько стоит зеркало 600×800 мм с подсветкой?',
  'Помоги составить ответ клиенту на вопрос о цене',
  'Какие аргументы использовать против возражения «дорого»?',
  'Что входит в монтаж лофт-перегородки?',
]

export default function AIAssistantPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [toolsRunning, setToolsRunning] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim()
    if (!content || isLoading) return

    const history: Message[] = [...messages, { role: 'user', content }]
    setMessages([...history, { role: 'assistant', content: '', streaming: true }])
    setInput('')
    setIsLoading(true)
    setToolsRunning(false)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((m): MessageParam => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.body) throw new Error('Нет ответа от сервера')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const lines = decoder.decode(value).split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6)
          if (raw === '[DONE]') { setToolsRunning(false); break }
          try {
            const event = JSON.parse(raw)
            if (event.type === 'text') {
              accumulated += event.text
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: accumulated, streaming: true }
                return updated
              })
            } else if (event.type === 'tool_call') {
              setToolsRunning(true)
            } else if (event.type === 'error') {
              accumulated = `Ошибка: ${event.error}`
            }
          } catch {}
        }
      }

      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: accumulated || 'Нет ответа от сервера.',
          streaming: false,
        }
        return updated
      })
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `Ошибка: ${err instanceof Error ? err.message : 'Что-то пошло не так'}`,
          streaming: false,
        }
        return updated
      })
    } finally {
      setIsLoading(false)
      setToolsRunning(false)
    }
  }

  return (
    <div className="max-w-[860px] mx-auto px-6 py-8">
      <PageHeader
        title="AI Ассистент"
        subtitle="Помогает отвечать клиентам, считать ориентировочные цены, работать с возражениями"
      />

      <div className="flex flex-col" style={{ height: 'calc(100vh - 200px)', minHeight: 400 }}>
        <div className="flex-1 overflow-y-auto space-y-3 pb-4 pr-1">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <div className="w-12 h-12 rounded-2xl bg-line-soft flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
                </svg>
              </div>
              <p className="text-[14px] font-semibold text-ink mb-1">Чем могу помочь?</p>
              <p className="text-[13px] text-muted mb-6">Спрашивайте о ценах, продуктах, помощи с клиентом</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-[520px]">
                {QUICK_PROMPTS.map(p => (
                  <button key={p} onClick={() => sendMessage(p)}
                    className="text-[12px] px-3 py-1.5 rounded-lg bg-line-soft text-ink-soft hover:bg-line transition-colors text-left">
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-ink text-white rounded-tr-sm'
                  : 'bg-surface border border-line text-ink rounded-tl-sm'
              }`}>
                {msg.content || !msg.streaming ? (
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <div className="flex gap-1 py-0.5">
                    {[0, 150, 300].map(d => (
                      <span key={d} className="w-1.5 h-1.5 bg-faint rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {toolsRunning && (
            <div className="flex justify-start">
              <span className="text-[12px] text-muted bg-subtle border border-line rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Проверяю данные...
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-line pt-4">
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder="Введите сообщение…"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-line px-4 py-3 text-[13px] text-ink placeholder:text-faint focus:outline-none focus:border-muted transition-colors"
              style={{ minHeight: 44, maxHeight: 140 }}
            />
            <button onClick={() => sendMessage()} disabled={isLoading || !input.trim()}
              className="h-[44px] w-[44px] rounded-xl bg-ink text-white disabled:opacity-30 hover:bg-[#2a2a28] transition-colors flex-shrink-0 flex items-center justify-center">
              {isLoading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-[11px] text-faint mt-1.5 ml-1">Shift+Enter — новая строка</p>
        </div>
      </div>
    </div>
  )
}
