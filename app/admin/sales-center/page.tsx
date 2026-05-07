'use client'

import { useEffect, useState } from 'react'

type Script = {
  id: number
  category: string
  title: string
  trigger_desc: string | null
  body: string
  is_featured: boolean
  active: boolean
}

type Feedback = {
  id: string
  rating: 'good' | 'bad'
  message_content: string
  comment: string | null
  category: string | null
  created_at: string
}

const CATEGORY_LABELS: Record<string, string> = {
  objection_expensive: 'Возражение: дорого',
  objection_compare:   'Возражение: конкуренты',
  measurement_close:   'Закрытие на замер',
  followup:            'Follow-up',
  upsell:              'Апселл',
  vip:                 'VIP клиент',
}

const CATEGORY_COLORS: Record<string, string> = {
  objection_expensive: 'bg-red-50 text-red-700 border-red-200',
  objection_compare:   'bg-orange-50 text-orange-700 border-orange-200',
  measurement_close:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  followup:            'bg-blue-50 text-blue-700 border-blue-200',
  upsell:              'bg-purple-50 text-purple-700 border-purple-200',
  vip:                 'bg-amber-50 text-amber-700 border-amber-200',
}

type Tab = 'scripts' | 'feedback' | 'insights'

const EMPTY_SCRIPT: Omit<Script, 'id'> = {
  category: 'objection_expensive', title: '', trigger_desc: '', body: '', is_featured: false, active: true,
}

export default function SalesCenterPage() {
  const [tab, setTab] = useState<Tab>('scripts')
  const [scripts, setScripts] = useState<Script[]>([])
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedScript, setExpandedScript] = useState<number | null>(null)
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'good' | 'bad'>('all')
  const [form, setForm] = useState<Omit<Script, 'id'>>(EMPTY_SCRIPT)
  const [editId, setEditId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => { loadScripts() }, [])
  useEffect(() => { if (tab === 'feedback') loadFeedback() }, [tab])

  async function loadScripts() {
    setLoading(true)
    const res = await fetch('/api/admin/sales-scripts')
    setScripts(res.ok ? await res.json() : [])
    setLoading(false)
  }

  async function loadFeedback() {
    const q = feedbackFilter !== 'all' ? `?rating=${feedbackFilter}` : ''
    const res = await fetch(`/api/admin/sales-feedback${q}`)
    setFeedback(res.ok ? await res.json() : [])
  }

  useEffect(() => { if (tab === 'feedback') loadFeedback() }, [feedbackFilter])

  async function toggleScript(s: Script) {
    await fetch('/api/admin/sales-scripts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, active: !s.active }),
    })
    setScripts(prev => prev.map(x => x.id === s.id ? { ...x, active: !x.active } : x))
  }

  async function toggleFeatured(s: Script) {
    await fetch('/api/admin/sales-scripts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, is_featured: !s.is_featured }),
    })
    setScripts(prev => prev.map(x => x.id === s.id ? { ...x, is_featured: !x.is_featured } : x))
  }

  function startEdit(s: Script) {
    setForm({ category: s.category, title: s.title, trigger_desc: s.trigger_desc ?? '', body: s.body, is_featured: s.is_featured, active: s.active })
    setEditId(s.id)
    setShowForm(true)
  }

  function startNew() {
    setForm(EMPTY_SCRIPT)
    setEditId(null)
    setShowForm(true)
  }

  async function saveScript() {
    if (!form.title.trim() || !form.body.trim()) return
    setSaving(true)
    await fetch('/api/admin/sales-scripts', {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editId ? { id: editId, ...form } : form),
    })
    setSaving(false)
    setShowForm(false)
    loadScripts()
  }

  async function deleteScript(id: number) {
    if (!confirm('Удалить скрипт?')) return
    await fetch('/api/admin/sales-scripts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setScripts(prev => prev.filter(s => s.id !== id))
  }

  function copyScript(s: Script) {
    navigator.clipboard.writeText(s.body)
    setCopied(s.id)
    setTimeout(() => setCopied(null), 2000)
  }

  const grouped = scripts.reduce<Record<string, Script[]>>((acc, s) => {
    ;(acc[s.category] ??= []).push(s)
    return acc
  }, {})

  const goodCount = feedback.filter(f => f.rating === 'good').length
  const badCount  = feedback.filter(f => f.rating === 'bad').length

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-1">Только для владельца</p>
          <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Sales Center</h1>
          <p className="text-[13px] text-[#6b6b66] mt-1">
            Скрипты продаж, обратная связь на ответы AI, аналитика качества
          </p>
        </div>
        {tab === 'scripts' && (
          <button
            onClick={startNew}
            className="flex-shrink-0 px-4 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] transition-colors"
          >
            + Скрипт
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[#f5f5f0] rounded-xl p-1 w-fit">
        {(['scripts', 'feedback', 'insights'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
              tab === t ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66] hover:text-[#111110]'
            }`}
          >
            {{ scripts: 'Скрипты', feedback: 'Обратная связь', insights: 'Инсайты' }[t]}
          </button>
        ))}
      </div>

      {/* SCRIPTS TAB */}
      {tab === 'scripts' && (
        <div className="space-y-6">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <div className="flex items-center gap-3 mb-3">
                <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${CATEGORY_COLORS[cat] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                  {CATEGORY_LABELS[cat] ?? cat}
                </span>
                <div className="flex-1 h-px bg-[#e4e4e0]" />
              </div>
              <div className="space-y-2">
                {items.map(s => (
                  <div key={s.id} className={`bg-white border rounded-xl transition-opacity ${s.active ? 'border-[#e4e4e0]' : 'border-[#f0f0ec] opacity-50'}`}>
                    <div
                      className="flex items-center justify-between gap-3 p-4 cursor-pointer"
                      onClick={() => setExpandedScript(expandedScript === s.id ? null : s.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {s.is_featured && <span className="text-amber-400 text-sm flex-shrink-0">★</span>}
                        <span className="text-[13px] font-medium text-[#111110] truncate">{s.title}</span>
                        {s.trigger_desc && (
                          <span className="hidden sm:block text-[12px] text-[#8a8a85] truncate">— {s.trigger_desc}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); copyScript(s) }}
                          className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors"
                        >
                          {copied === s.id ? '✓ Скопировано' : 'Копировать'}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); toggleFeatured(s) }}
                          className={`text-[11px] px-2 py-1 rounded-lg transition-colors ${s.is_featured ? 'text-amber-500' : 'text-[#c0c0bb] hover:text-amber-400'}`}
                          title="Лучший скрипт"
                        >★</button>
                        <button
                          onClick={e => { e.stopPropagation(); startEdit(s) }}
                          className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors"
                        >Ред.</button>
                        <button
                          onClick={e => { e.stopPropagation(); toggleScript(s) }}
                          className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors"
                        >{s.active ? 'Откл.' : 'Вкл.'}</button>
                        <button
                          onClick={e => { e.stopPropagation(); deleteScript(s.id) }}
                          className="text-[11px] px-2 py-1 rounded-lg text-red-400 hover:text-red-600 transition-colors"
                        >✕</button>
                        <span className="text-[#c0c0bb] text-sm">{expandedScript === s.id ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    {expandedScript === s.id && (
                      <div className="border-t border-[#f0f0ec] px-4 pb-4 pt-3">
                        {s.trigger_desc && (
                          <p className="text-[12px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                            <span className="font-semibold">Когда использовать:</span> {s.trigger_desc}
                          </p>
                        )}
                        <pre className="text-[13px] text-[#111110] leading-relaxed whitespace-pre-wrap font-sans bg-[#fafaf8] rounded-lg p-4">
                          {s.body}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {scripts.length === 0 && (
            <div className="text-center py-16 text-[13px] text-[#8a8a85]">
              Нет скриптов. Нажмите «+ Скрипт» чтобы добавить первый.
            </div>
          )}
        </div>
      )}

      {/* FEEDBACK TAB */}
      {tab === 'feedback' && (
        <div>
          <div className="flex items-center gap-4 mb-5">
            <div className="flex gap-1 bg-[#f5f5f0] rounded-xl p-1">
              {(['all', 'good', 'bad'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFeedbackFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                    feedbackFilter === f ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66]'
                  }`}
                >
                  {{ all: 'Все', good: `✓ Хорошие (${goodCount})`, bad: `✕ Плохие (${badCount})` }[f]}
                </button>
              ))}
            </div>
          </div>

          {feedback.length === 0 && (
            <div className="text-center py-16 text-[13px] text-[#8a8a85]">
              Нет отзывов. Менеджеры могут помечать ответы AI как хорошие или плохие.
            </div>
          )}
          <div className="space-y-3">
            {feedback.map(f => (
              <div key={f.id} className={`bg-white border rounded-xl p-4 ${f.rating === 'good' ? 'border-emerald-200' : 'border-red-200'}`}>
                <div className="flex items-start gap-3">
                  <span className={`text-lg flex-shrink-0 ${f.rating === 'good' ? 'text-emerald-500' : 'text-red-500'}`}>
                    {f.rating === 'good' ? '✓' : '✕'}
                  </span>
                  <div className="min-w-0 flex-1">
                    {f.category && (
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border inline-block mb-2 ${CATEGORY_COLORS[f.category] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                        {CATEGORY_LABELS[f.category] ?? f.category}
                      </span>
                    )}
                    <p className="text-[13px] text-[#111110] leading-relaxed whitespace-pre-wrap">{f.message_content}</p>
                    {f.comment && (
                      <p className="text-[12px] text-[#6b6b66] mt-2 italic">Комментарий: {f.comment}</p>
                    )}
                    <p className="text-[11px] text-[#8a8a85] mt-2">
                      {new Date(f.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* INSIGHTS TAB */}
      {tab === 'insights' && (
        <div className="space-y-5">

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <h3 className="text-[14px] font-semibold text-blue-900 mb-3">Принципы AI Sales Manager</h3>
            <div className="space-y-2">
              {[
                ['🎯', 'Главная цель', 'Закрыть на замер или следующий шаг — не продать по переписке'],
                ['🧠', 'Сначала потребность', 'Выявить: что именно нужно, для чего, какой бюджет, когда'],
                ['💎', 'Продавать ценность', 'Не цену — а безопасность, долговечность, сервис, экспертность'],
                ['🛑', 'Не снижать сразу', 'При "дорого" — сначала объяснить состав цены, потом альтернатива'],
                ['🎁', 'Бонус — не первым ходом', 'Бонус предлагается только при явном поводе, не автоматически'],
                ['👑', 'VIP-клиенты', 'Дизайнеры и премиальные объекты — спокойно, без "дешёвых продаж"'],
              ].map(([icon, title, desc]) => (
                <div key={title} className="flex items-start gap-3">
                  <span className="flex-shrink-0 text-base">{icon}</span>
                  <div>
                    <span className="text-[13px] font-semibold text-blue-900">{title}: </span>
                    <span className="text-[13px] text-blue-800">{desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-[#e4e4e0] rounded-xl p-5">
            <h3 className="text-[14px] font-semibold text-[#111110] mb-3">Типы клиентов и стратегия</h3>
            <div className="space-y-3">
              {[
                { type: 'Горячий', signs: 'Есть размеры, называет сроки, просит точную цену', strategy: 'Быстро считаем, предлагаем замер сегодня/завтра', color: 'border-l-emerald-400' },
                { type: 'Тёплый', signs: 'Интересуется, сравнивает, задаёт вопросы', strategy: 'Экспертные советы, показываем ценность, не торопим', color: 'border-l-blue-400' },
                { type: 'Холодный', signs: 'Пишет "сколько стоит" без деталей', strategy: 'Задаём уточняющие вопросы, выявляем потребность', color: 'border-l-amber-400' },
                { type: 'Бюджетный', signs: 'Называет низкий бюджет или сравнивает с дешёвыми', strategy: 'Предлагаем бюджетную серию, объясняем минимальный состав', color: 'border-l-orange-400' },
                { type: 'VIP', signs: 'Дизайнер, дорогой ЖК, говорит про материалы и стиль', strategy: 'Премиальный тон, без скриптов, спрашиваем про проект', color: 'border-l-purple-400' },
              ].map(c => (
                <div key={c.type} className={`pl-4 border-l-4 ${c.color}`}>
                  <p className="text-[13px] font-semibold text-[#111110]">{c.type}</p>
                  <p className="text-[12px] text-[#6b6b66]"><span className="font-medium">Признаки:</span> {c.signs}</p>
                  <p className="text-[12px] text-[#6b6b66]"><span className="font-medium">Стратегия:</span> {c.strategy}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-[#e4e4e0] rounded-xl p-5">
            <h3 className="text-[14px] font-semibold text-[#111110] mb-3">Follow-up правила</h3>
            <div className="space-y-2 text-[13px] text-[#6b6b66]">
              {[
                ['2–3 дня без ответа', 'Лёгкий follow-up: "Есть вопросы? Готов помочь разобраться"'],
                ['5+ дней после замера', 'Отправить готовый расчёт и уточнить, что останавливает'],
                ['Клиент сказал "подумаю"', 'Через 2 дня: предложить ответить на любой вопрос'],
                ['Потерянный клиент (1+ мес)', 'Раз — спросить, актуальна ли тема. Дважды не пишем'],
              ].map(([trigger, action]) => (
                <div key={trigger} className="flex gap-3">
                  <span className="flex-shrink-0 text-[#8a8a85] min-w-[160px]">{trigger}</span>
                  <span className="text-[#111110]">{action}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* Script form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-5">
              {editId ? 'Изменить скрипт' : 'Новый скрипт'}
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Категория</label>
                  <select
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Название</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Дорого — первый ответ"
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Когда использовать</label>
                <input
                  type="text"
                  value={form.trigger_desc ?? ''}
                  onChange={e => setForm(f => ({ ...f, trigger_desc: e.target.value }))}
                  placeholder="Клиент говорит 'дорого' или называет дешёвый аналог"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Текст скрипта</label>
                <textarea
                  value={form.body}
                  onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  rows={8}
                  placeholder="Введите текст скрипта..."
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono"
                />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_featured} onChange={e => setForm(f => ({ ...f, is_featured: e.target.checked }))} className="w-4 h-4 rounded" />
                  <span className="text-[13px] text-[#111110]">★ Лучший скрипт</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="w-4 h-4 rounded" />
                  <span className="text-[13px] text-[#111110]">Активен</span>
                </label>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={saveScript}
                disabled={saving}
                className="px-5 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-5 py-2 border border-[#e4e4e0] rounded-xl text-[13px] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
