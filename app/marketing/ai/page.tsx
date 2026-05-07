'use client'

import { useState, useRef, useEffect } from 'react'

type Message = { role: 'user' | 'assistant'; content: string }

const QUICK_PROMPTS = [
  { label: '3 идеи контента',     prompt: 'Предложи 3 конкретные идеи для контента MGlass на сегодня. Разные категории: производство, совет клиенту, кейс.' },
  { label: 'Сценарий Reels',      prompt: 'Напиши полный сценарий Reels для MGlass. Тема: самая частая ошибка при выборе душевой. Включи хук, структуру, текст диктора, кадры и CTA.' },
  { label: 'WhatsApp-статус',     prompt: 'Придумай 3 WhatsApp-статуса для MGlass. Разные темы: экспертность, кейс, призыв на замер. Лаконично, живо, с emoji.' },
  { label: 'Оффер для дизайнеров',prompt: 'Разработай оффер для дизайнеров интерьера: почему им выгодно работать с MGlass. Что они получают, как работает партнёрская программа.' },
  { label: 'Анализ слабых мест',  prompt: 'Проанализируй слабые места в маркетинге MGlass. Что недоупаковано? Где теряются лиды? Что нужно усилить в первую очередь?' },
  { label: 'B2B стратегия',       prompt: 'Разработай конкретную стратегию продвижения MGlass в B2B сегменте. Кто целевая аудитория, какие каналы, какой оффер, первые шаги.' },
  { label: 'Идея акции',          prompt: 'Придумай сезонную акцию для MGlass на ближайший месяц. Условие: акция не должна снижать маржу ниже 25%.' },
  { label: 'Посты на неделю',     prompt: 'Составь план контента на 7 дней для Instagram/Telegram MGlass. Каждый день: тема, платформа, короткое описание, хук.' },
]

export default function AIMarketerPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(text?: string) {
    const userText = (text ?? input).trim()
    if (!userText || streaming) return
    setInput('')

    const userMsg: Message = { role: 'user', content: userText }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setStreaming(true)

    const aiMsg: Message = { role: 'assistant', content: '' }
    setMessages(prev => [...prev, aiMsg])

    try {
      const res = await fetch('/api/ai/marketing-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages.map(m => ({ role: m.role, content: m.content })) }),
      })
      if (!res.body) throw new Error('No body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'text') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + data.text }
                return updated
              })
            }
          } catch {}
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: 'Ошибка при обращении к AI. Попробуйте снова.' }
        return updated
      })
    } finally {
      setStreaming(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] max-w-3xl mx-auto px-4">

      {/* Header */}
      <div className="py-5 border-b border-[#e4e4e0] flex-shrink-0">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">AI-маркетолог</h1>
        <p className="text-[13px] text-[#6b6b66] mt-0.5">Сценарии, посты, идеи, стратегии — работает как директор по маркетингу MGlass</p>
      </div>

      {/* Quick prompts */}
      {messages.length === 0 && (
        <div className="py-5 flex-shrink-0">
          <p className="text-[12px] font-medium text-[#8a8a85] uppercase tracking-wider mb-3">Быстрый старт</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map(q => (
              <button key={q.label} onClick={() => send(q.prompt)}
                className="text-[12px] px-3 py-1.5 rounded-xl border border-[#e4e4e0] text-[#6b6b66] hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition-colors">
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0 mt-0.5 mr-2">M</div>
            )}
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${
              m.role === 'user'
                ? 'bg-[#111110] text-white rounded-br-sm'
                : 'bg-white border border-[#e4e4e0] text-[#111110] rounded-bl-sm'
            }`}>
              {m.content ? (
                <pre className="whitespace-pre-wrap font-sans">{m.content}</pre>
              ) : (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8a8a85] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8a8a85] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8a8a85] animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="py-4 flex-shrink-0 border-t border-[#e4e4e0]">
        {messages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {QUICK_PROMPTS.slice(0, 4).map(q => (
              <button key={q.label} onClick={() => send(q.prompt)} disabled={streaming}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-40">
                {q.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={streaming}
            placeholder="Попроси AI: написать пост, придумать акцию, сделать сценарий Reels..."
            rows={2}
            className="flex-1 border border-[#e4e4e0] rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
          />
          <button onClick={() => send()} disabled={!input.trim() || streaming}
            className="flex-shrink-0 px-4 py-3 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] disabled:opacity-40 transition-colors">
            {streaming ? '...' : '→'}
          </button>
        </div>
        <p className="text-[11px] text-[#8a8a85] mt-2">Enter — отправить · Shift+Enter — новая строка</p>
      </div>
    </div>
  )
}
