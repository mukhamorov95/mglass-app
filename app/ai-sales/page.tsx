'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages/messages'

type Message = {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

type Calculation = {
  id: number
  product_type: string
  final_price: number
  created_at: string
}

const PRODUCT_LABELS: Record<string, string> = {
  mirror: 'Зеркало',
  loft: 'Лофт',
  shower: 'Душевая',
  order: 'Заказ',
}

const QUICK_PROMPTS = [
  'Сколько стоит зеркало 600×800 мм с подсветкой?',
  'Помоги составить ответ клиенту на вопрос о цене',
  'Какие аргументы использовать против возражения "дорого"?',
  'Что входит в монтаж лофт-перегородки?',
]

export default function AISalesPage() {
  const [mode, setMode] = useState<'chat' | 'kp'>('chat')

  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [toolsRunning, setToolsRunning] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // KP state
  const [calculations, setCalculations] = useState<Calculation[]>([])
  const [selectedCalcId, setSelectedCalcId] = useState<number | ''>('')
  const [kpContext, setKpContext] = useState('')
  const [kpResult, setKpResult] = useState('')
  const [kpLoading, setKpLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    createClient()
      .from('calculations')
      .select('id,product_type,final_price,created_at')
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => setCalculations(data ?? []))
  }, [])

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
          content: accumulated || 'Нет ответа от сервера. Проверьте подключение.',
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

  async function generateKP() {
    setKpLoading(true)
    setKpResult('')
    setCopied(false)
    try {
      const res = await fetch('/api/ai/generate-kp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calculation_id: selectedCalcId || null, context: kpContext }),
      })
      const data = await res.json()
      setKpResult(data.text ?? data.error ?? 'Нет результата')
    } catch (err) {
      setKpResult(`Ошибка: ${err instanceof Error ? err.message : 'Что-то пошло не так'}`)
    } finally {
      setKpLoading(false)
    }
  }

  function copyKP() {
    navigator.clipboard.writeText(kpResult)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-[860px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[18px] font-bold text-[#111110] tracking-tight">AI Sales</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">Ассистент по продажам MGlass</p>
        </div>
        <div className="flex rounded-lg border border-[#e4e4e0] overflow-hidden">
          {(['chat', 'kp'] as const).map((m, i) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 text-[13px] font-medium transition-colors ${
                i > 0 ? 'border-l border-[#e4e4e0]' : ''
              } ${mode === m ? 'bg-[#111110] text-white' : 'bg-white text-[#6b6b66] hover:bg-[#f8f8f6]'}`}
            >
              {m === 'chat' ? 'Ассистент' : 'КП Генератор'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'chat' ? (
        <div className="flex flex-col" style={{ height: 'calc(100vh - 210px)', minHeight: 400 }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-3 pb-4 pr-1">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <div className="w-12 h-12 rounded-2xl bg-[#f0f0ec] flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-[#6b6b66]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
                  </svg>
                </div>
                <p className="text-[14px] font-semibold text-[#111110] mb-1">Чем могу помочь?</p>
                <p className="text-[13px] text-[#9a9a95] mb-6">Спрашивайте о ценах, продуктах, помощи с клиентом</p>
                <div className="flex flex-wrap gap-2 justify-center max-w-[520px]">
                  {QUICK_PROMPTS.map(p => (
                    <button
                      key={p}
                      onClick={() => sendMessage(p)}
                      className="text-[12px] px-3 py-1.5 rounded-lg bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4] transition-colors text-left"
                    >
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
                    ? 'bg-[#111110] text-white rounded-tr-sm'
                    : 'bg-white border border-[#e4e4e0] text-[#111110] rounded-tl-sm'
                }`}>
                  {msg.content || !msg.streaming ? (
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <div className="flex gap-1 py-0.5">
                      {[0, 150, 300].map(delay => (
                        <span
                          key={delay}
                          className="w-1.5 h-1.5 bg-[#c4c4be] rounded-full animate-bounce"
                          style={{ animationDelay: `${delay}ms` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {toolsRunning && (
              <div className="flex justify-start">
                <span className="text-[12px] text-[#9a9a95] bg-[#f8f8f6] border border-[#e8e8e4] rounded-lg px-3 py-1.5 flex items-center gap-1.5">
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

          {/* Input */}
          <div className="border-t border-[#e4e4e0] pt-4">
            <div className="flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
                }}
                placeholder="Введите сообщение…"
                rows={1}
                className="flex-1 resize-none rounded-xl border border-[#e4e4e0] px-4 py-3 text-[13px] text-[#111110] placeholder:text-[#c4c4be] focus:outline-none focus:border-[#8a8a85] transition-colors overflow-hidden"
                style={{ minHeight: 44, maxHeight: 140 }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={isLoading || !input.trim()}
                className="h-[44px] w-[44px] rounded-xl bg-[#111110] text-white disabled:opacity-30 hover:bg-[#2a2a28] transition-colors flex-shrink-0 flex items-center justify-center"
              >
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
            <p className="text-[11px] text-[#c4c4be] mt-1.5 ml-1">Shift+Enter — новая строка</p>
          </div>
        </div>
      ) : (
        /* КП Генератор */
        <div className="space-y-4">
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-6 space-y-5">
            <div>
              <label className="block text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-2">
                Расчёт (необязательно)
              </label>
              <select
                value={selectedCalcId}
                onChange={e => setSelectedCalcId(e.target.value ? Number(e.target.value) : '')}
                className="w-full rounded-lg border border-[#e4e4e0] px-3 py-2.5 text-[13px] text-[#111110] bg-white focus:outline-none focus:border-[#8a8a85] transition-colors"
              >
                <option value="">— Без расчёта (универсальный шаблон)</option>
                {calculations.map(c => (
                  <option key={c.id} value={c.id}>
                    #{c.id} · {PRODUCT_LABELS[c.product_type] ?? c.product_type} · {c.final_price.toLocaleString('ru-RU')} ₽ · {new Date(c.created_at).toLocaleDateString('ru-RU')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-2">
                Дополнительный контекст
              </label>
              <textarea
                value={kpContext}
                onChange={e => setKpContext(e.target.value)}
                placeholder="Имя клиента, пожелания по тону, особые условия…"
                rows={3}
                className="w-full rounded-lg border border-[#e4e4e0] px-3 py-2.5 text-[13px] text-[#111110] placeholder:text-[#c4c4be] focus:outline-none focus:border-[#8a8a85] transition-colors resize-none"
              />
            </div>

            <button
              onClick={generateKP}
              disabled={kpLoading}
              className="w-full py-3 rounded-xl bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40 hover:bg-[#2a2a28] transition-colors flex items-center justify-center gap-2"
            >
              {kpLoading && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {kpLoading ? 'Генерирую…' : 'Сгенерировать КП'}
            </button>
          </div>

          {kpResult && (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[14px] font-semibold text-[#111110]">Готовое КП</h3>
                <button
                  onClick={copyKP}
                  className="text-[12px] px-3 py-1.5 rounded-lg bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4] transition-colors flex items-center gap-1.5"
                >
                  {copied ? (
                    <>
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Скопировано
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Копировать
                    </>
                  )}
                </button>
              </div>
              <div className="text-[13px] text-[#111110] leading-relaxed whitespace-pre-wrap bg-[#f8f8f6] rounded-lg p-4 border border-[#ececea]">
                {kpResult}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
