'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CORE_KEYS, FLAG_BY_KEY, type FlagKey, type LeadFlags } from '@/lib/avito/flags'

// Песочница AI-менеджера Авито: диалог с тем же движком и тем же решением о передаче
// менеджеру, что в вебхуке, + портрет клиента, длина ответа и решение. Ничего не пишет.

type Msg = { from: 'client' | 'manager'; text: string }
type Turn = {
  reply: string
  extracted: Record<string, string | null>
  est_amount: number | null
  qualified: boolean
  score: number
  score_reason: string
  needs_human: boolean
  flags: LeadFlags
  handoff: boolean
  budget: number
  shortened: 'none' | 'rewrite' | 'trim'
  knowledge_gap: string | null
  decision: { action: string; reason: string }
  portrait: { done: number; total: number; next: FlagKey | null }
}

const ACTION_LABEL: Record<string, string> = {
  collect: 'Собирает портрет', handoff: 'Передал менеджеру', close_measure: 'Передал менеджеру (замер)',
  park: 'Клиент отложил', disqualify: 'Не наш клиент',
}

const FIELD_LABEL: Record<string, string> = {
  name: 'Имя', product: 'Продукт', sizes: 'Размеры', city: 'Город', budget: 'Бюджет', phone: 'Телефон',
}

export default function BotTestPage() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<Turn | null>(null)
  const [known, setKnown] = useState<Record<string, string | null>>({})
  const [flags, setFlags] = useState<LeadFlags>({})
  const [handedOff, setHandedOff] = useState(false)

  async function send() {
    const text = input.trim()
    if (!text || busy || handedOff) return
    const history: Msg[] = [...msgs, { from: 'client', text }]
    setMsgs(history)
    setInput('')
    setBusy(true)
    try {
      const r = await fetch('/api/avito/simulate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history, known, flags }),
      })
      const turn = await r.json() as Turn & { error?: string }
      if (turn.error) {
        setMsgs(prev => [...prev, { from: 'manager', text: `⚠️ ${turn.error}` }])
      } else {
        setMsgs(prev => [...prev, { from: 'manager', text: turn.reply }])
        setLast(turn)
        setFlags(turn.flags ?? {})
        if (turn.handoff) setHandedOff(true)
        setKnown(prev => {
          const next = { ...prev }
          for (const [k, v] of Object.entries(turn.extracted ?? {})) if (v) next[k] = v
          return next
        })
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">🤖 Песочница AI-менеджера Авито</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          Пишите как клиент с Авито — отвечает тот же движок, что будет говорить с клиентами. Ничего не сохраняется.
          {' '}<Link href="/crm" className="underline text-[#6b6b66]">← в CRM</Link>
        </p>
      </div>

      <div className="px-5 pt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-[1100px]">
        {/* Диалог */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#e4e4e0] flex flex-col min-h-[480px]">
          <div className="flex-1 p-4 space-y-2.5 overflow-y-auto">
            {msgs.length === 0 && (
              <p className="text-[13px] text-[#9a9a95]">Например: «Здравствуйте, сколько стоит зеркало 700 на 1500 с подсветкой?»</p>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] whitespace-pre-wrap ${
                m.from === 'client' ? 'bg-[#111110] text-white ml-auto' : 'bg-[#f0f0ec] text-[#111110]'}`}>
                {m.text}
              </div>
            ))}
            {handedOff && <p className="text-[12px] text-center text-[#9a9a95] pt-2">Клиент передан менеджеру — дальше бот в этом чате молчит</p>}
            {busy && <div className="bg-[#f0f0ec] rounded-2xl px-3.5 py-2 text-[13px] text-[#9a9a95] w-fit">печатает…</div>}
          </div>
          <div className="border-t border-[#f0f0ec] p-3 flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send() }}
              placeholder={handedOff ? 'Бот передал клиента менеджеру' : 'Сообщение клиента…'} disabled={busy || handedOff}
              className="flex-1 border border-[#e4e4e0] rounded-xl px-3.5 py-2.5 text-[13px] outline-none focus:border-[#111110]" />
            <button onClick={send} disabled={busy || handedOff || !input.trim()}
              className="px-4 py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40">➤</button>
          </div>
        </div>

        {/* Что бот снял с диалога */}
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Карточка лида (наживую)</p>
            {Object.keys(known).length === 0 && <p className="text-[12px] text-[#c4c4be]">Пока пусто</p>}
            {Object.entries(known).map(([k, v]) => v && (
              <p key={k} className="text-[13px] py-0.5"><span className="text-[#9a9a95]">{FIELD_LABEL[k] ?? k}:</span> {v}</p>
            ))}
          </div>
          {last && (
            <div className={`rounded-xl border p-4 space-y-2 ${last.handoff ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-[#e4e4e0]'}`}>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95]">Решение</p>
              <p className="text-[14px] font-bold text-[#111110]">{ACTION_LABEL[last.decision.action] ?? last.decision.action}</p>
              <p className="text-[12px] text-[#6b6b66]">{last.decision.reason}</p>
            </div>
          )}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Портрет клиента {last ? `· ${last.portrait.done}/${last.portrait.total}` : ''}</p>
            {CORE_KEYS.map(k => {
              const done = k === 'finish_known' ? !!(flags.finish_known || flags.object_ready) : !!flags[k]
              return (
                <p key={k} className={`text-[13px] py-0.5 ${done ? 'text-[#111110]' : 'text-[#b0b0aa]'}`}>
                  {done ? '✓' : '○'} {FLAG_BY_KEY[k].label}{last?.portrait.next === k && !done ? ' — спросит следующим' : ''}
                </p>
              )
            })}
            {flags.price_asked && <p className="text-[12px] text-amber-700 mt-1.5">Спросил цену — считает менеджер</p>}
          </div>
          {last && (
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">Последний ответ</p>
              <p className={`text-[13px] ${last.reply.length > last.budget ? 'text-red-600' : 'text-[#111110]'}`}>
                <span className="font-mono">{last.reply.length}</span> из <span className="font-mono">{last.budget}</span> символов
              </p>
              {last.shortened !== 'none' && <p className="text-[12px] text-[#9a9a95]">{last.shortened === 'rewrite' ? 'Модель переписала короче' : 'Сокращено кодом'}</p>}
              {last.knowledge_gap && <p className="text-[12px] text-amber-700">Не знал: {last.knowledge_gap}</p>}
            </div>
          )}
          <button onClick={() => { setMsgs([]); setLast(null); setKnown({}); setFlags({}); setHandedOff(false) }}
            className="w-full py-2 rounded-xl border border-[#e4e4e0] text-[12px] text-[#6b6b66] hover:border-[#111110]">
            ↺ Новый диалог
          </button>
        </div>
      </div>
    </div>
  )
}
