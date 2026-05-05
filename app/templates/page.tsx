'use client'

import { useState } from 'react'

const CATEGORIES = [
  {
    label: 'Первый контакт',
    templates: [
      { id: 'inbound_call',  label: 'Входящий звонок', desc: 'Клиент звонит по рекламе' },
      { id: 'inbound_chat',  label: 'Сообщение в мессенджере', desc: 'Клиент написал в WhatsApp/Telegram' },
      { id: 'site_request',  label: 'Заявка с сайта', desc: 'Форма заявки или корзина' },
    ],
  },
  {
    label: 'Работа со сделкой',
    templates: [
      { id: 'send_kp',       label: 'Отправляем КП', desc: 'Сообщение при отправке коммерческого предложения' },
      { id: 'followup_1',    label: 'Напоминание (день 1)', desc: 'Если нет ответа на КП' },
      { id: 'followup_3',    label: 'Напоминание (день 3)', desc: 'Второй фоллоу-ап' },
      { id: 'schedule_msr',  label: 'Назначить замер', desc: 'Переход к назначению выезда' },
    ],
  },
  {
    label: 'Закрытие',
    templates: [
      { id: 'after_measure', label: 'После замера', desc: 'Сообщение после выезда замерщика' },
      { id: 'invoice',       label: 'Счёт и договор', desc: 'Сопровождение к оплате' },
      { id: 'win',           label: 'Сделка закрыта', desc: 'Финальное сообщение + просьба об отзыве' },
    ],
  },
]

const CHANNELS = ['WhatsApp / Telegram', 'Email', 'Instagram DM', 'Звонок (скрипт)']

const SYSTEM = `Ты — топ-менеджер по продажам MGlass.
MGlass: зеркала с LED-подсветкой, лофт-перегородки, душевые перегородки. Производство своё, монтаж в Москве.
Пиши живые, конкретные шаблоны — без воды и «уважаемый клиент». Текст должен читаться как настоящее сообщение от менеджера.`

export default function TemplatesPage() {
  const [selected, setSelected] = useState<string | null>(null)
  const [channel, setChannel] = useState(CHANNELS[0])
  const [context, setContext] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const allTemplates = CATEGORIES.flatMap(c => c.templates)
  const selectedTemplate = allTemplates.find(t => t.id === selected)

  async function generate() {
    if (!selected || !selectedTemplate) return
    setLoading(true)
    setResult('')
    setCopied(false)
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: SYSTEM,
          prompt: `Шаблон: «${selectedTemplate.label}» (${selectedTemplate.desc})
Канал: ${channel}
${context ? `Контекст: ${context}` : ''}

Напиши готовый шаблон сообщения. Формат:
— Текст сообщения (готов к отправке)
— Варианты персонализации (в [скобках])
— Совет: что добавить от себя`,
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
        <h1 className="text-[18px] font-bold text-[#111110] tracking-tight">Шаблоны переписки</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">Готовые тексты для каждого этапа сделки</p>
      </div>

      <div className="space-y-4 mb-5">
        {CATEGORIES.map(cat => (
          <div key={cat.label}>
            <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-2 px-1">{cat.label}</p>
            <div className="grid grid-cols-3 gap-2">
              {cat.templates.map(t => (
                <button key={t.id} onClick={() => setSelected(t.id)}
                  className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                    selected === t.id
                      ? 'border-[#111110] bg-[#111110] text-white'
                      : 'border-[#e4e4e0] bg-white text-[#6b6b66] hover:border-[#c4c4be]'
                  }`}>
                  <span className="text-[12px] font-semibold leading-tight">{t.label}</span>
                  <span className={`text-[11px] mt-0.5 leading-tight ${selected === t.id ? 'text-white/60' : 'text-[#b4b4ae]'}`}>{t.desc}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-2">Канал</label>
          <select value={channel} onChange={e => setChannel(e.target.value)}
            className="w-full rounded-lg border border-[#e4e4e0] px-3 py-2.5 text-[13px] text-[#111110] bg-white focus:outline-none focus:border-[#8a8a85]">
            {CHANNELS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-2">
            Детали <span className="font-normal normal-case text-[#c4c4be]">(необязательно)</span>
          </label>
          <input value={context} onChange={e => setContext(e.target.value)}
            placeholder="Зеркало 80×100 см, клиентка Анна, рассматривает два варианта..."
            className="w-full rounded-lg border border-[#e4e4e0] px-3 py-2.5 text-[13px] placeholder:text-[#c4c4be] focus:outline-none focus:border-[#8a8a85]" />
        </div>

        <button onClick={generate} disabled={!selected || loading}
          className="w-full py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40 hover:bg-[#2a2a28] transition-colors flex items-center justify-center gap-2">
          {loading && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
          {loading ? 'Генерирую шаблон...' : 'Получить шаблон'}
        </button>
      </div>

      {result && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold text-[#111110]">Шаблон сообщения</h3>
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
