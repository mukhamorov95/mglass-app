'use client'

import { useEffect, useState } from 'react'

type Answers = Record<string, string>

const MONTHS = [
  { v: '1', l: 'Янв' }, { v: '2', l: 'Фев' }, { v: '3', l: 'Мар' },
  { v: '4', l: 'Апр' }, { v: '5', l: 'Май' }, { v: '6', l: 'Июн' },
  { v: '7', l: 'Июл' }, { v: '8', l: 'Авг' }, { v: '9', l: 'Сен' },
  { v: '10', l: 'Окт' }, { v: '11', l: 'Ноя' }, { v: '12', l: 'Дек' },
]

const SECTIONS = [
  {
    id: 'finance',
    title: 'Финансовые цели',
    icon: '💰',
    color: 'border-purple-200',
    questions: [
      {
        key: 'target_margin',
        label: 'Целевая маржа на заказ',
        type: 'number',
        unit: '%',
        hint: 'При какой марже вы считаете заказ хорошим?',
        default: '40',
      },
      {
        key: 'min_margin',
        label: 'Минимальная маржа (красная зона)',
        type: 'number',
        unit: '%',
        hint: 'Ниже этого значения — нужно согласование с вами',
        default: '25',
      },
      {
        key: 'monthly_revenue_target',
        label: 'Плановая выручка в месяц',
        type: 'number',
        unit: '₽',
        hint: 'Сколько хотите зарабатывать в месяц (выручка, не прибыль)',
        default: '3000000',
      },
      {
        key: 'max_manager_discount',
        label: 'Макс. скидка без согласования',
        type: 'number',
        unit: '%',
        hint: 'Скидку больше этой менеджер должен согласовывать',
        default: '10',
      },
    ],
  },
  {
    id: 'production',
    title: 'Производство и качество',
    icon: '⚙️',
    color: 'border-blue-200',
    questions: [
      {
        key: 'warranty_days',
        label: 'Гарантийный срок',
        type: 'number',
        unit: 'дней',
        hint: 'Стандартная гарантия на изделие',
        default: '365',
      },
      {
        key: 'scrap_rate',
        label: 'Норма потерь стекла',
        type: 'number',
        unit: '%',
        hint: 'Средний процент стекла, уходящего в брак при производстве',
        default: '5',
      },
      {
        key: 'lead_time_standard',
        label: 'Срок изготовления стандартного заказа',
        type: 'number',
        unit: 'р.дней',
        hint: 'Сколько рабочих дней от оплаты до готовности',
        default: '7',
      },
      {
        key: 'lead_time_express',
        label: 'Срок изготовления срочного заказа',
        type: 'number',
        unit: 'р.дней',
        hint: 'При наценке за срочность',
        default: '3',
      },
    ],
  },
  {
    id: 'clients',
    title: 'Клиентская стратегия',
    icon: '👤',
    color: 'border-orange-200',
    questions: [
      {
        key: 'b2b_min_order',
        label: 'Минимальная сумма B2B заказа',
        type: 'number',
        unit: '₽',
        hint: 'Ниже этого порога B2B заказ нецелесообразен',
        default: '50000',
      },
      {
        key: 'new_clients_monthly',
        label: 'Целевое количество новых клиентов',
        type: 'number',
        unit: 'в мес.',
        hint: 'Сколько новых клиентов должен приводить отдел продаж',
        default: '20',
      },
      {
        key: 'price_positioning',
        label: 'Позиционирование по цене',
        type: 'select',
        options: [
          { v: 'cheaper', l: 'Дешевле конкурентов' },
          { v: 'same', l: 'На уровне рынка' },
          { v: 'premium', l: 'Дороже (премиум)' },
        ],
        hint: 'Как вы позиционируете MGlass по цене?',
        default: 'same',
      },
    ],
  },
  {
    id: 'operations',
    title: 'Операции',
    icon: '🚚',
    color: 'border-emerald-200',
    questions: [
      {
        key: 'installation_mode',
        label: 'Монтаж',
        type: 'select',
        options: [
          { v: 'own', l: 'Своими силами' },
          { v: 'sub', l: 'Субподряд' },
          { v: 'both', l: 'Оба варианта' },
        ],
        hint: 'Как обычно выполняется монтаж?',
        default: 'own',
      },
      {
        key: 'peak_months',
        label: 'Пиковые месяцы',
        type: 'months',
        hint: 'В какие месяцы загрузка максимальная?',
        default: '4,5,9,10,11',
      },
    ],
  },
  {
    id: 'growth',
    title: 'Приоритеты роста',
    icon: '🚀',
    color: 'border-rose-200',
    questions: [
      {
        key: 'top_product_priority',
        label: 'Приоритетный продукт для развития',
        type: 'select',
        options: [
          { v: 'shower', l: 'Душевые перегородки' },
          { v: 'mirror', l: 'Зеркала с подсветкой' },
          { v: 'loft', l: 'Лофт-перегородки' },
          { v: 'b2b', l: 'B2B (оптовые поставки)' },
          { v: 'all', l: 'Равномерно все' },
        ],
        hint: 'На какой категории сосредоточить маркетинг и продажи?',
        default: 'shower',
      },
      {
        key: 'growth_priority',
        label: 'Главный приоритет на ближайшие 6 месяцев',
        type: 'textarea',
        hint: 'Своими словами — что самое важное? Открыть склад, нанять менеджеров, выйти на B2B...',
        default: '',
      },
    ],
  },
]

function fmt(key: string, val: string) {
  if (!val) return '—'
  const q = SECTIONS.flatMap(s => s.questions).find(q => q.key === key)
  if (!q) return val
  if (q.type === 'select') {
    const opt = (q as { options?: { v: string; l: string }[] }).options?.find(o => o.v === val)
    return opt?.l ?? val
  }
  if (q.type === 'months') {
    return val.split(',').filter(Boolean).map(m => MONTHS.find(x => x.v === m)?.l ?? m).join(', ')
  }
  const unit = (q as { unit?: string }).unit
  if (unit) return `${Number(val).toLocaleString('ru-RU')} ${unit}`
  return val
}

export default function OwnerQuestionnairePage() {
  const [answers, setAnswers] = useState<Answers>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/owner-strategy')
      .then(r => r.json())
      .then(data => {
        const defaults: Answers = {}
        for (const s of SECTIONS)
          for (const q of s.questions)
            defaults[q.key] = data[q.key] ?? q.default
        setAnswers(defaults)
        setLoading(false)
      })
  }, [])

  function set(key: string, value: string) {
    setAnswers(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function toggleMonth(m: string) {
    const current = (answers['peak_months'] ?? '').split(',').filter(Boolean)
    const next = current.includes(m) ? current.filter(x => x !== m) : [...current, m]
    set('peak_months', next.sort((a, b) => Number(a) - Number(b)).join(','))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await fetch('/api/admin/owner-strategy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answers),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setError(json.error ?? 'Ошибка'); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-muted">Загрузка...</div>
  )

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">

      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Только для владельца</p>
        <h1 className="text-[24px] font-semibold text-ink tracking-tight">Стратегический опросник</h1>
        <p className="text-[14px] text-ink-soft mt-1">
          Ответы используются системой для формул, предупреждений и автоматических решений.
          Заполните один раз, обновляйте при изменении стратегии.
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {SECTIONS.map(section => (
          <div key={section.id} className={`bg-surface border-2 ${section.color} rounded-2xl p-6`}>
            <div className="flex items-center gap-2 mb-5">
              <span className="text-lg">{section.icon}</span>
              <h2 className="text-[15px] font-semibold text-ink">{section.title}</h2>
            </div>
            <div className="space-y-5">
              {section.questions.map(q => (
                <div key={q.key}>
                  <label className="block text-[13px] font-medium text-ink mb-1">
                    {q.label}
                    {'unit' in q && q.unit && (
                      <span className="ml-1 text-muted font-normal">({q.unit})</span>
                    )}
                  </label>
                  {q.hint && (
                    <p className="text-[12px] text-muted mb-2">{q.hint}</p>
                  )}

                  {q.type === 'number' && (
                    <input
                      type="number"
                      value={answers[q.key] ?? ''}
                      onChange={e => set(q.key, e.target.value)}
                      className="w-full sm:w-48 border border-line rounded-lg px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  )}

                  {q.type === 'select' && (
                    <select
                      value={answers[q.key] ?? ''}
                      onChange={e => set(q.key, e.target.value)}
                      className="w-full sm:w-72 border border-line rounded-lg px-3 py-2 text-[13px] text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-blue-300"
                    >
                      {(q as { options?: { v: string; l: string }[] }).options?.map(o => (
                        <option key={o.v} value={o.v}>{o.l}</option>
                      ))}
                    </select>
                  )}

                  {q.type === 'months' && (
                    <div className="flex flex-wrap gap-2">
                      {MONTHS.map(m => {
                        const active = (answers['peak_months'] ?? '').split(',').includes(m.v)
                        return (
                          <button
                            key={m.v}
                            type="button"
                            onClick={() => toggleMonth(m.v)}
                            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                              active
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'bg-surface border-line text-ink-soft hover:border-blue-300'
                            }`}
                          >
                            {m.l}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {q.type === 'textarea' && (
                    <textarea
                      value={answers[q.key] ?? ''}
                      onChange={e => set(q.key, e.target.value)}
                      rows={3}
                      placeholder="Введите текст..."
                      className="w-full border border-line rounded-lg px-3 py-2 text-[13px] text-ink resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Save bar */}
      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-ink text-white rounded-xl text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-50"
        >
          {saving ? 'Сохранение...' : 'Сохранить ответы'}
        </button>
        {saved && (
          <span className="text-[13px] text-emerald-600 font-medium">✓ Сохранено</span>
        )}
        {error && (
          <span className="text-[13px] text-red-500">{error}</span>
        )}
      </div>

      {/* Summary preview */}
      <div className="mt-10 bg-canvas rounded-2xl p-6">
        <h3 className="text-[13px] font-semibold text-ink uppercase tracking-wider mb-4">Текущие настройки</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SECTIONS.flatMap(s => s.questions).filter(q => q.key !== 'growth_priority').map(q => (
            <div key={q.key} className="flex items-baseline justify-between gap-2 py-1.5 border-b border-line">
              <span className="text-[12px] text-muted min-w-0 truncate">{q.label}</span>
              <span className="text-[13px] font-medium text-ink whitespace-nowrap tabular-nums">{fmt(q.key, answers[q.key] ?? '')}</span>
            </div>
          ))}
        </div>
        {answers['growth_priority'] && (
          <div className="mt-4 pt-4 border-t border-line">
            <p className="text-[12px] text-muted mb-1">Главный приоритет</p>
            <p className="text-[13px] text-ink leading-relaxed">{answers['growth_priority']}</p>
          </div>
        )}
      </div>

    </div>
  )
}
