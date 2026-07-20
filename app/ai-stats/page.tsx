'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Chat = {
  chat_id: string
  client_name: string | null
  amo_lead_id: number | null
  is_active: boolean
  close_reason: 'measurement' | 'human' | null
  created_at: string
  last_message_at: string | null
  channel_id: string
  message_count: number
  last_message: string | null
}

type Message = { role: 'user' | 'assistant'; content: string; created_at: string }

function Badge({ type }: { type: 'measurement' | 'human' | 'active' | 'new' }) {
  const map = {
    measurement: { label: '✅ Замер', cls: 'bg-emerald-100 text-emerald-700' },
    human:       { label: '👤 Менеджер', cls: 'bg-amber-100 text-amber-700' },
    active:      { label: '💬 В диалоге', cls: 'bg-blue-100 text-blue-700' },
    new:         { label: '🆕 Новый', cls: 'bg-slate-100 text-slate-600' },
  }
  const { label, cls } = map[type]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function statusOf(chat: Chat): 'measurement' | 'human' | 'active' | 'new' {
  if (chat.is_active) return chat.last_message_at ? 'active' : 'new'
  return chat.close_reason ?? 'active'
}

function fmt(date: string) {
  return new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtPhone(raw: string) {
  const d = raw.replace(/\D/g, '')
  if (d.length === 11) return `+${d[0]} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9)}`
  return raw
}

export default function AiStatsPage() {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const { data: chatRows } = await sb
        .from('ai_managed_chats')
        .select('*')
        .neq('chat_id', '__debug__')
        .order('created_at', { ascending: false })

      if (!chatRows) { setLoading(false); return }

      // Get message counts + last messages for all chats
      const enriched = await Promise.all(
        chatRows.map(async (c: Chat) => {
          const { data: msgs, count } = await sb
            .from('ai_conversations')
            .select('role, content, created_at', { count: 'exact' })
            .eq('chat_id', c.chat_id)
            .order('created_at', { ascending: false })
            .limit(1)

          return {
            ...c,
            message_count: count ?? 0,
            last_message: msgs?.[0]?.content?.slice(0, 80) ?? null,
          } as Chat
        })
      )

      setChats(enriched)
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [])

  async function openChat(chat: Chat) {
    setSelected(chat)
    setLoadingMsgs(true)
    const sb = createClient()
    const { data } = await sb
      .from('ai_conversations')
      .select('role, content, created_at')
      .eq('chat_id', chat.chat_id)
      .order('created_at', { ascending: true })
    setMessages((data as Message[]) ?? [])
    setLoadingMsgs(false)
  }

  const realChats = chats.filter(c => c.chat_id !== '__debug__')
  const total       = realChats.length
  const measurement = realChats.filter(c => c.close_reason === 'measurement').length
  const human       = realChats.filter(c => c.close_reason === 'human').length
  const active      = realChats.filter(c => c.is_active).length
  const convRate    = total > 0 ? Math.round((measurement / total) * 100) : 0

  const CARDS = [
    { label: 'Всего диалогов', value: total, sub: 'обработал AI', color: 'text-[#1d1d1f]' },
    { label: 'Закрыто на замер', value: measurement, sub: `конверсия ${convRate}%`, color: 'text-emerald-600' },
    { label: 'Передано менеджеру', value: human, sub: 'потребовался человек', color: 'text-amber-600' },
    { label: 'Активных сейчас', value: active, sub: 'в диалоге', color: 'text-blue-600' },
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-[22px] font-semibold text-[#1d1d1f] mb-1">Статистика AI-менеджера</h1>
      <p className="text-[13px] text-[#6e6e73] mb-6">Все диалоги Владислава с клиентами</p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {CARDS.map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
            <p className="text-[12px] text-[#6e6e73] mb-1">{c.label}</p>
            <p className={`text-[28px] font-bold leading-none mb-1 ${c.color}`}>{loading ? '—' : c.value}</p>
            <p className="text-[11px] text-[#aeaeb2]">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Conversion bar */}
      {total > 0 && (
        <div className="bg-white rounded-2xl border border-[#e8e8ed] p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-medium text-[#1d1d1f]">Конверсия в замер</p>
            <p className="text-[13px] font-semibold text-emerald-600">{convRate}%</p>
          </div>
          <div className="h-2 bg-[#f2f2f7] rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${convRate}%` }}
            />
          </div>
          <div className="flex gap-4 mt-2">
            <span className="text-[11px] text-[#6e6e73]">✅ Замер: {measurement}</span>
            <span className="text-[11px] text-[#6e6e73]">👤 Менеджер: {human}</span>
            <span className="text-[11px] text-[#6e6e73]">💬 Активно: {active}</span>
          </div>
        </div>
      )}

      {/* Chat list */}
      <div className="bg-white rounded-2xl border border-[#e8e8ed] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f2f2f7]">
          <p className="text-[14px] font-semibold text-[#1d1d1f]">Все диалоги</p>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-[13px] text-[#aeaeb2]">Загрузка...</div>
        ) : realChats.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-[#aeaeb2]">Диалогов пока нет</div>
        ) : (
          <div className="divide-y divide-[#f2f2f7]">
            {realChats.map(chat => (
              <button
                key={chat.chat_id}
                onClick={() => openChat(chat)}
                className="w-full px-5 py-4 flex items-start gap-4 hover:bg-[#f9f9fb] transition-colors text-left"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-[#f2f2f7] flex items-center justify-center text-[15px] shrink-0">
                  {chat.client_name ? chat.client_name[0].toUpperCase() : '?'}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="text-[14px] font-medium text-[#1d1d1f] truncate">
                      {chat.client_name || fmtPhone(chat.chat_id)}
                    </p>
                    <Badge type={statusOf(chat)} />
                  </div>

                  {chat.client_name && (
                    <p className="text-[12px] text-[#aeaeb2] mb-0.5">{fmtPhone(chat.chat_id)}</p>
                  )}

                  {chat.last_message && (
                    <p className="text-[12px] text-[#6e6e73] truncate">{chat.last_message}…</p>
                  )}

                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] text-[#aeaeb2]">{fmt(chat.created_at)}</span>
                    <span className="text-[11px] text-[#aeaeb2]">{chat.message_count} сообщений</span>
                    {chat.amo_lead_id && (
                      <a
                        href={`https://mglass.amocrm.ru/leads/detail/${chat.amo_lead_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-[11px] text-[#0071e3] hover:underline"
                      >
                        AMO →
                      </a>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Conversation drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30" onClick={() => setSelected(null)} />
          <div className="w-full max-w-md bg-white flex flex-col shadow-2xl">
            {/* Header */}
            <div className="px-5 py-4 border-b border-[#e8e8ed] flex items-center justify-between">
              <div>
                <p className="text-[15px] font-semibold text-[#1d1d1f]">
                  {selected.client_name || fmtPhone(selected.chat_id)}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge type={statusOf(selected)} />
                  <span className="text-[11px] text-[#aeaeb2]">{fmt(selected.created_at)}</span>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="w-8 h-8 rounded-full bg-[#f2f2f7] flex items-center justify-center text-[#6e6e73] hover:bg-[#e8e8ed]"
              >
                ✕
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingMsgs ? (
                <p className="text-center text-[13px] text-[#aeaeb2] py-10">Загрузка...</p>
              ) : messages.length === 0 ? (
                <p className="text-center text-[13px] text-[#aeaeb2] py-10">Нет сообщений</p>
              ) : messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'assistant' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap
                    ${m.role === 'assistant'
                      ? 'bg-[#0071e3] text-white rounded-br-sm'
                      : 'bg-[#f2f2f7] text-[#1d1d1f] rounded-bl-sm'
                    }`}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            {selected.amo_lead_id && (
              <div className="px-5 py-4 border-t border-[#e8e8ed]">
                <a
                  href={`https://mglass.amocrm.ru/leads/detail/${selected.amo_lead_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-[13px] text-[#0071e3] font-medium"
                >
                  Открыть сделку в AmoCRM →
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
