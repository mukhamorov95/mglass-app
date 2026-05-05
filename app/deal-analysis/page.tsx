'use client'

import { useState } from 'react'

const STAGES = [
  { id: 'new',      label: 'Новая заявка',      icon: '📥' },
  { id: 'contact',  label: 'Взяли контакт',     icon: '📞' },
  { id: 'kp_sent',  label: 'КП отправлено',     icon: '📄' },
  { id: 'measure',  label: 'Замер назначен',     icon: '📐' },
  { id: 'thinking', label: 'Думает / молчит',    icon: '🤔' },
  { id: 'objection',label: 'Возражение',         icon: '⚠️' },
]

const SYSTEM = `Ты — старший менеджер по продажам MGlass с 10-летним опытом, специализируешься на анализе сделок.
MGlass: зеркала с подсветкой, лофт-перегородки, душевые перегородки. Производство своё, Москва.
Дай чёткий анализ ситуации и конкретный план действий. Без воды.`

export default function DealAnalysisPage() {
  const [stage, setStage] = useState<string | null>(null)
  const [situation, setSituation] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function analyze() {
    if (!stage || !situation.trim()) return
    const stg = STAGES.find(s => s.id === stage)!
    setLoading(true)
    setResult('')
    setCopied(false)
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: SYSTEM,
          prompt: `Этап сделки: ${stg.label}
Ситуация: ${situation}

Проанализируй сделку и дай план. Формат:
— Оценка ситуации (что сейчас происходит на самом деле)
— Риски (что может пойти не так)
— Конкретные следующие шаги (1-2-3)
— Что сказать / написать клиенту прямо сейчас`,
        }),
      })
      const data = await res.json()
      setResult(data.text ?? data.error)
    } finally {
      setLoading(false)
    }
  }

  function copy() {
    navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-[720px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[18px] font-bold text-[#111110] tracking-tight">Анализ сделки</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">Опиши ситуацию — получи план действий по конкретному клиенту</p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-5">
        {STAGES.map(s => (
          <button key={s.id} onClick={() => setStage(s.id)}
            className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
              stage === s.id
                ? 'border-[#111110] bg-[#111110] text-white'
                : 'border-[#e4e4e0] bg-white text-[#6b6b66] hover:border-[#c4c4be]'
            }`}>
            <span className="text-[18px]">{s.icon}</span>
            <span className="text-[12px] font-semibold leading-tight">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-2">
            Опиши ситуацию по клиенту
          </label>
          <textarea
            value={situation}
            onChange={e => setSituation(e.target.value)}
            placeholder="Клиент звонил 3 дня назад, смотрел лофт-перегородку 3×2 м под кухню. Сказал «надо посовещаться с женой». Сумма ~85 000₽. Уже 2 дня не отвечает на сообщения..."
            rows={4}
            className="w-full rounded-lg border border-[#e4e4e0] px-3 py-2.5 text-[13px] text-[#111110] placeholder:text-[#c4c4be] focus:outline-none focus:border-[#8a8a85] resize-none"
          />
        </div>

        <button onClick={analyze} disabled={!stage || !situation.trim() || loading}
          className="w-full py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40 hover:bg-[#2a2a28] transition-colors flex items-center justify-center gap-2">
          {loading && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
          {loading ? 'Анализирую...' : 'Проанализировать сделку'}
        </button>
      </div>

      {result && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold text-[#111110]">Анализ и план действий</h3>
            <button onClick={copy}
              className="text-[12px] px-3 py-1.5 rounded-lg bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4] transition-colors">
              {copied ? '✓ Скопировано' : 'Копировать'}
            </button>
          </div>
          <div className="text-[13px] text-[#111110] leading-relaxed whitespace-pre-wrap bg-[#f8f8f6] rounded-lg p-4 border border-[#ececea]">
            {result}
          </div>
        </div>
      )}
    </div>
  )
}
