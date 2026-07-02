'use client'

import { useState } from 'react'

const OBJECTIONS = [
  { id: 'expensive',    label: 'Дорого',                  icon: '💰' },
  { id: 'think',        label: 'Я подумаю',               icon: '🤔' },
  { id: 'competitors',  label: 'У других дешевле',        icon: '🏪' },
  { id: 'quality',      label: 'Сомневаюсь в качестве',   icon: '🔍' },
  { id: 'slow',         label: 'Долго ждать',             icon: '⏳' },
  { id: 'diy',          label: 'Сами купим стекло',       icon: '🔨' },
  { id: 'notnow',       label: 'Сейчас не актуально',     icon: '📅' },
  { id: 'measure',      label: 'Нужен точный замер',      icon: '📐' },
]

const PRODUCTS = [
  'Зеркало с подсветкой',
  'Лофт-перегородка',
  'Душевая перегородка',
  'Стеклянная конструкция',
]

const SYSTEM = `Ты — топ-менеджер по продажам MGlass с 10-летним опытом.
MGlass производит: зеркала с подсветкой (LED, сенсорные), лофт-перегородки (металл + стекло), душевые перегородки.
Качество выше рынка, производство своё, гарантия 2 года, монтаж в штате.
Дай конкретный скрипт ответа менеджера — живой, без шаблонных фраз. 3-5 реплик с логикой.`

export default function ObjectionsPage() {
  const [selected, setSelected] = useState<string | null>(null)
  const [product, setProduct] = useState(PRODUCTS[0])
  const [context, setContext] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    if (!selected) return
    const obj = OBJECTIONS.find(o => o.id === selected)!
    setLoading(true)
    setResult('')
    setCopied(false)
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: SYSTEM,
          prompt: `Возражение клиента: «${obj.label}»
Продукт: ${product}
${context ? `Контекст: ${context}` : ''}

Напиши скрипт ответа менеджера. Формат:
— Что сказать сразу (1-2 предложения)
— Ключевой аргумент под MGlass
— Как перевести в следующий шаг (замер / расчёт / встреча)`,
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
        <h1 className="text-[18px] font-semibold text-ink tracking-tight">Работа с возражениями</h1>
        <p className="text-[13px] text-muted mt-0.5">Выбери возражение — получи готовый скрипт ответа</p>
      </div>

      {/* Сетка возражений */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {OBJECTIONS.map(o => (
          <button key={o.id} onClick={() => setSelected(o.id)}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all ${
              selected === o.id
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-surface text-ink-soft hover:border-faint'
            }`}>
            <span className="text-[20px]">{o.icon}</span>
            <span className="text-[11px] font-semibold leading-tight">{o.label}</span>
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
            Детали ситуации <span className="font-normal normal-case text-faint">(необязательно)</span>
          </label>
          <input value={context} onChange={e => setContext(e.target.value)}
            placeholder="Клиент сравнивает с ИКЕА, бюджет 30 000₽..."
            className="w-full rounded-lg border border-line px-3 py-2.5 text-[13px] placeholder:text-faint focus:outline-none focus:border-muted" />
        </div>

        <button onClick={generate} disabled={!selected || loading}
          className="w-full py-2.5 rounded-xl bg-ink text-white text-[13px] font-semibold disabled:opacity-40 hover:bg-[#2a2a28] transition-colors flex items-center justify-center gap-2">
          {loading && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
          {loading ? 'Генерирую скрипт...' : 'Получить скрипт ответа'}
        </button>
      </div>

      {result && (
        <div className="bg-surface border border-line rounded-xl p-5 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold text-ink">Скрипт ответа</h3>
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
