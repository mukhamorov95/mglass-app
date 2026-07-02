'use client'

import { useState } from 'react'

const COMPETITORS = [
  { id: 'ikea',      label: 'IKEA',              icon: '🟡' },
  { id: 'leroymer',  label: 'Leroy Merlin',       icon: '🟢' },
  { id: 'local',     label: 'Местный цех',        icon: '🔧' },
  { id: 'aliexpress',label: 'AliExpress/WB',      icon: '📦' },
  { id: 'other',     label: 'Другая компания',    icon: '🏢' },
]

const PRODUCTS = [
  'Зеркало с подсветкой',
  'Лофт-перегородка',
  'Душевая перегородка',
]

const SYSTEM = `Ты — эксперт по конкурентным продажам MGlass.
MGlass: собственное производство в Москве, зеркала с LED (сенсорные, антизапотевание), лофт-перегородки, душевые перегородки. Гарантия 2 года, монтаж в штате, 14-дневный срок.
Сравнение должно быть честным и выигрышным для MGlass. Не врать — подчёркивать реальные преимущества.`

export default function CompetitorsPage() {
  const [competitor, setCompetitor] = useState<string | null>(null)
  const [product, setProduct] = useState(PRODUCTS[0])
  const [clientSays, setClientSays] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    if (!competitor) return
    const comp = COMPETITORS.find(c => c.id === competitor)!
    setLoading(true)
    setResult('')
    setCopied(false)
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: SYSTEM,
          prompt: `Клиент сравнивает MGlass с: ${comp.label}
Продукт: ${product}
${clientSays ? `Что говорит клиент: ${clientSays}` : ''}

Дай сравнительный анализ. Формат:
— Что хорошего у конкурента (честно)
— В чём MGlass объективно выигрывает
— Что сказать клиенту (2-3 конкретные фразы)
— Ключевой аргумент-закрыватель`,
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
        <h1 className="text-[18px] font-semibold text-ink tracking-tight">Сравнение с конкурентами</h1>
        <p className="text-[13px] text-muted mt-0.5">Аргументы в пользу MGlass против конкретного конкурента</p>
      </div>

      <div className="grid grid-cols-5 gap-2 mb-5">
        {COMPETITORS.map(c => (
          <button key={c.id} onClick={() => setCompetitor(c.id)}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all ${
              competitor === c.id
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-surface text-ink-soft hover:border-faint'
            }`}>
            <span className="text-[18px]">{c.icon}</span>
            <span className="text-[11px] font-semibold leading-tight">{c.label}</span>
          </button>
        ))}
      </div>

      <div className="bg-surface border border-line rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-2">Продукт</label>
          <select value={product} onChange={e => setProduct(e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2.5 text-[13px] text-ink bg-surface focus:outline-none focus:border-muted">
            {PRODUCTS.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-2">
            Что говорит клиент <span className="font-normal normal-case text-faint">(необязательно)</span>
          </label>
          <input value={clientSays} onChange={e => setClientSays(e.target.value)}
            placeholder="«В ИКЕА такое же за 8 000₽», «там гарантия 3 года», «у вас дороже»..."
            className="w-full rounded-lg border border-line px-3 py-2.5 text-[13px] placeholder:text-faint focus:outline-none focus:border-muted" />
        </div>

        <button onClick={generate} disabled={!competitor || loading}
          className="w-full py-2.5 rounded-xl bg-ink text-white text-[13px] font-semibold disabled:opacity-40 hover:bg-[#2a2a28] transition-colors flex items-center justify-center gap-2">
          {loading && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
          {loading ? 'Анализирую...' : 'Получить аргументы'}
        </button>
      </div>

      {result && (
        <div className="bg-surface border border-line rounded-xl p-5 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold text-ink">Аргументы MGlass</h3>
            <button onClick={copy}
              className="text-[12px] px-3 py-1.5 rounded-lg bg-line-soft text-ink-soft hover:bg-line transition-colors">
              {copied ? '✓ Скопировано' : 'Копировать'}
            </button>
          </div>
          <div className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap bg-canvas rounded-lg p-4 border border-line">
            {result}
          </div>
        </div>
      )}
    </div>
  )
}
