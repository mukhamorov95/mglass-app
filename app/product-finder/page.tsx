'use client'

import { useState } from 'react'

const PURPOSES = [
  { id: 'bathroom',   label: 'Ванная комната',    icon: '🚿' },
  { id: 'bedroom',    label: 'Спальня',            icon: '🛏' },
  { id: 'hallway',    label: 'Прихожая',           icon: '🚪' },
  { id: 'office',     label: 'Офис / переговорка', icon: '🏢' },
  { id: 'restaurant', label: 'Ресторан / кафе',    icon: '🍽' },
  { id: 'retail',     label: 'Магазин / шоурум',   icon: '🏪' },
]

const BUDGETS = ['До 20 000 ₽', '20 000 – 50 000 ₽', '50 000 – 100 000 ₽', 'Свыше 100 000 ₽']
const PRIORITIES = ['Цена', 'Внешний вид', 'Практичность', 'Статусность']

const SYSTEM = `Ты — консультант MGlass, эксперт по подбору стеклянных конструкций.
MGlass делает: зеркала с LED-подсветкой (сенсорные, с антизапотеванием), лофт-перегородки (металл + стекло, разные RAL), душевые перегородки.
Производство своё, гарантия 2 года, монтаж в Москве и области.
Подбери конкретный продукт под запрос. Объясни почему именно он. Назови ориентировочную стоимость и следующий шаг.`

export default function ProductFinderPage() {
  const [purpose, setPurpose] = useState<string | null>(null)
  const [budget, setBudget] = useState(BUDGETS[1])
  const [priority, setPriority] = useState(PRIORITIES[0])
  const [details, setDetails] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    if (!purpose) return
    const purp = PURPOSES.find(p => p.id === purpose)!
    setLoading(true)
    setResult('')
    setCopied(false)
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: SYSTEM,
          prompt: `Помещение: ${purp.label}
Бюджет: ${budget}
Приоритет: ${priority}
${details ? `Дополнительно: ${details}` : ''}

Подбери оптимальный продукт MGlass. Формат:
— Рекомендую (название + краткое описание)
— Почему подходит именно для этого случая
— Ориентировочная стоимость
— Что нужно для просчёта`,
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
        <h1 className="text-[18px] font-semibold text-ink tracking-tight">Подбор продукта</h1>
        <p className="text-[13px] text-muted mt-0.5">Укажи параметры — AI подберёт оптимальный продукт MGlass</p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-5">
        {PURPOSES.map(p => (
          <button key={p.id} onClick={() => setPurpose(p.id)}
            className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
              purpose === p.id
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-surface text-ink-soft hover:border-faint'
            }`}>
            <span className="text-[18px]">{p.icon}</span>
            <span className="text-[12px] font-semibold leading-tight">{p.label}</span>
          </button>
        ))}
      </div>

      <div className="bg-surface border border-line rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-2">Бюджет</label>
            <select value={budget} onChange={e => setBudget(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2.5 text-[13px] text-ink bg-surface focus:outline-none focus:border-muted">
              {BUDGETS.map(b => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-2">Приоритет</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2.5 text-[13px] text-ink bg-surface focus:outline-none focus:border-muted">
              {PRIORITIES.map(pr => <option key={pr}>{pr}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-2">
            Пожелания клиента <span className="font-normal normal-case text-faint">(необязательно)</span>
          </label>
          <input value={details} onChange={e => setDetails(e.target.value)}
            placeholder="Хочет чёрный металл, размер ~2×2 м, под дизайн-проект..."
            className="w-full rounded-lg border border-line px-3 py-2.5 text-[13px] placeholder:text-faint focus:outline-none focus:border-muted" />
        </div>

        <button onClick={generate} disabled={!purpose || loading}
          className="w-full py-2.5 rounded-xl bg-ink text-white text-[13px] font-semibold disabled:opacity-40 hover:bg-[#2a2a28] transition-colors flex items-center justify-center gap-2">
          {loading && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
          {loading ? 'Подбираю...' : 'Подобрать продукт'}
        </button>
      </div>

      {result && (
        <div className="bg-surface border border-line rounded-xl p-5 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold text-ink">Рекомендация</h3>
            <button onClick={copy}
              className="text-[12px] px-3 py-1.5 rounded-lg bg-line-soft text-ink-soft hover:bg-line transition-colors flex items-center gap-1.5">
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
