'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

type Chat = {
  chat_id: string
  client_name: string | null
  amo_lead_id: number | null
  is_active: boolean
  close_reason: 'measurement' | 'human' | null
  created_at: string
  last_message_at: string | null
  last_message: string | null
  last_role: 'user' | 'assistant' | null
  message_count: number
}

type Tab = 'attention' | 'active' | 'measurement' | 'all'

function Badge({ type }: { type: 'measurement' | 'human' | 'active' | 'new' | 'unread' }) {
  const map = {
    measurement: { label: '✅ Замер',         cls: 'bg-emerald-100 text-emerald-700' },
    human:       { label: '❗ Нужен ответ',   cls: 'bg-red-100 text-red-600' },
    active:      { label: '💬 В диалоге',     cls: 'bg-blue-100 text-blue-700' },
    new:         { label: '🆕 Новый',         cls: 'bg-slate-100 text-slate-600' },
    unread:      { label: '🔴 Не отвечено',   cls: 'bg-orange-100 text-orange-700' },
  }
  const { label, cls } = map[type]
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{label}</span>
}

function fmtPhone(raw: string) {
  const d = raw.replace(/\D/g, '')
  if (d.length === 11) return `+${d[0]} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9)}`
  return raw
}

function fmtTime(d: string) {
  const date = new Date(d)
  const now = new Date()
  const diffH = (now.getTime() - date.getTime()) / 3600000
  if (diffH < 1) return `${Math.round(diffH * 60)} мин назад`
  if (diffH < 24) return `${Math.round(diffH)} ч назад`
  return date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function statusOf(c: Chat): 'measurement' | 'human' | 'active' | 'new' | 'unread' {
  if (c.close_reason === 'measurement') return 'measurement'
  if (c.close_reason === 'human') return 'human'
  if (c.is_active) {
    // Client wrote last and bot hasn't responded → unread
    if (c.last_role === 'user') return 'unread'
    return c.last_message_at ? 'active' : 'new'
  }
  return 'new'
}

export default function VladislavPage() {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('attention')

  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  async function load() {
    const sb = createClient()
    const { data } = await sb
      .from('ai_managed_chats')
      .select('*')
      .neq('chat_id', '__debug__')
      .order('last_message_at', { ascending: false, nullsFirst: false })

    if (!data) { setLoading(false); return }

    const enriched = await Promise.all(data.map(async (c: Chat) => {
      const { data: msgs, count } = await sb
        .from('ai_conversations')
        .select('role, content, created_at', { count: 'exact' })
        .eq('chat_id', c.chat_id)
        .order('created_at', { ascending: false })
        .limit(1)
      return {
        ...c,
        message_count: count ?? 0,
        last_message: msgs?.[0]?.content?.slice(0, 100) ?? null,
        last_role: msgs?.[0]?.role ?? null,
      } as Chat
    }))

    setChats(enriched)
    setLoading(false)
  }

  const all = chats
  const attention    = chats.filter(c => c.close_reason === 'human' || (!c.is_active === false && c.last_role === 'user'))
  const needsReply   = chats.filter(c => c.close_reason === 'human' || statusOf(c) === 'unread')
  const measurement  = chats.filter(c => c.close_reason === 'measurement')
  const active       = chats.filter(c => c.is_active)

  const TABS: { id: Tab; label: string; count: number; urgent?: boolean }[] = [
    { id: 'attention',   label: 'Нужен ответ',   count: needsReply.length,  urgent: needsReply.length > 0 },
    { id: 'measurement', label: 'Замеры',         count: measurement.length },
    { id: 'active',      label: 'В диалоге',      count: active.length },
    { id: 'all',         label: 'Все',            count: all.length },
  ]

  const visible = tab === 'attention' ? needsReply
    : tab === 'measurement' ? measurement
    : tab === 'active' ? active
    : all

  const [botEnabled, setBotEnabled] = useState<boolean | null>(null)
  const [botToggling, setBotToggling] = useState(false)

  useEffect(() => {
    fetch('/api/admin/bot-toggle').then(r => r.json()).then(d => setBotEnabled(d.enabled))
  }, [])

  async function toggleBot() {
    setBotToggling(true)
    const next = !botEnabled
    await fetch('/api/admin/bot-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
    setBotEnabled(next)
    setBotToggling(false)
  }

  const QUICK = [
    { href: '/ai-stats', label: '📊 Статистика AI', sub: 'конверсия в замер' },
    { href: '/vladislav/calls', label: '📞 Анализ звонков', sub: 'расшифровка + AI' },
    { href: '/amo-analysis', label: '🔍 Анализ воронки', sub: 'AMO CRM' },
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-[#1d1d1f]">Кабинет Владислава</h1>
          <p className="text-[13px] text-[#6e6e73]">Управление AI-менеджером и клиентскими диалогами</p>
        </div>
        <div className="flex items-center gap-3">
          {botEnabled !== null && (
            <button
              onClick={toggleBot}
              disabled={botToggling}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-50 ${
                botEnabled
                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                  : 'bg-red-100 text-red-600 hover:bg-red-200'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${botEnabled ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {botToggling ? '...' : botEnabled ? 'Бот включён' : 'Бот выключен'}
            </button>
          )}
          <div className="w-10 h-10 rounded-full bg-[#0071e3] flex items-center justify-center text-white font-semibold text-[16px]">
            В
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {QUICK.map(q => (
          <Link key={q.href} href={q.href}
            className="bg-white rounded-2xl border border-[#e8e8ed] p-4 hover:border-[#0071e3] hover:shadow-sm transition-all">
            <p className="text-[14px] font-medium text-[#1d1d1f] mb-0.5">{q.label}</p>
            <p className="text-[12px] text-[#aeaeb2]">{q.sub}</p>
          </Link>
        ))}
      </div>

      {/* Messages section */}
      <div className="bg-white rounded-2xl border border-[#e8e8ed] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f2f2f7]">
          <p className="text-[15px] font-semibold text-[#1d1d1f] mb-3">Сообщения клиентов</p>
          {/* Tabs */}
          <div className="flex gap-1 bg-[#f2f2f7] rounded-xl p-1">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[9px] text-[12px] font-medium transition-all ${
                  tab === t.id
                    ? 'bg-white text-[#1d1d1f] shadow-sm'
                    : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                }`}>
                {t.label}
                {t.count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                    t.urgent ? 'bg-red-500 text-white' : 'bg-[#e8e8ed] text-[#6e6e73]'
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-[13px] text-[#aeaeb2]">Загрузка...</div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[14px] text-[#aeaeb2]">
              {tab === 'attention' ? 'Все клиенты обслужены' : 'Нет диалогов в этой категории'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#f2f2f7]">
            {visible.map(chat => {
              const status = statusOf(chat)
              return (
                <div key={chat.chat_id} className="px-5 py-4 flex items-start gap-3 hover:bg-[#f9f9fb] transition-colors">
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-semibold shrink-0 ${
                    status === 'unread' || status === 'human' ? 'bg-red-100 text-red-600' :
                    status === 'measurement' ? 'bg-emerald-100 text-emerald-700' :
                    'bg-[#f2f2f7] text-[#6e6e73]'
                  }`}>
                    {chat.client_name ? chat.client_name[0].toUpperCase() : '?'}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className="text-[14px] font-medium text-[#1d1d1f] truncate">
                        {chat.client_name || fmtPhone(chat.chat_id)}
                      </p>
                      <Badge type={status} />
                    </div>

                    {chat.client_name && (
                      <p className="text-[11px] text-[#aeaeb2]">{fmtPhone(chat.chat_id)}</p>
                    )}

                    {chat.last_message && (
                      <p className={`text-[13px] truncate mt-0.5 ${
                        status === 'unread' ? 'text-[#1d1d1f] font-medium' : 'text-[#6e6e73]'
                      }`}>
                        {chat.last_role === 'user' ? '← ' : '→ '}{chat.last_message}
                      </p>
                    )}

                    <div className="flex items-center gap-3 mt-1.5">
                      {chat.last_message_at && (
                        <span className="text-[11px] text-[#aeaeb2]">{fmtTime(chat.last_message_at)}</span>
                      )}
                      <span className="text-[11px] text-[#aeaeb2]">{chat.message_count} сообщ.</span>
                      {chat.amo_lead_id && (
                        <a href={`https://mglass.amocrm.ru/leads/detail/${chat.amo_lead_id}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-[#0071e3] hover:underline">
                          AMO →
                        </a>
                      )}
                      {(status === 'measurement' || status === 'human') && (
                        <a href={`https://wa.me/${chat.chat_id.replace(/\D/g, '')}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-emerald-600 font-medium hover:underline">
                          WhatsApp →
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
