'use client'

import { useEffect, useState } from 'react'

type ContentItem = {
  id: number
  category: string
  topic: string
  goal: string | null
  platform: string | null
  hook: string | null
  body: string | null
  video_idea: string | null
  cta: string | null
  status: string
  publish_date: string | null
}

const CATEGORIES = [
  { v: 'production',    l: '🏭 Производство' },
  { v: 'install',       l: '🔧 Монтажи' },
  { v: 'before_after',  l: '✨ До/после' },
  { v: 'mistakes',      l: '⚠️ Ошибки клиентов' },
  { v: 'tips',          l: '💡 Советы' },
  { v: 'case',          l: '📐 Кейсы' },
  { v: 'vip',           l: '👑 Премиальные' },
  { v: 'b2b',           l: '🏢 B2B' },
  { v: 'team',          l: '👥 Команда' },
  { v: 'compare',       l: '⚖️ Сравнение' },
  { v: 'why_price',     l: '💰 Почему дорого' },
  { v: 'product',       l: '📦 Продукты' },
  { v: 'partner',       l: '🤝 Партнёры' },
]

const PLATFORMS = [
  { v: 'instagram',  l: 'Instagram' },
  { v: 'reels',      l: 'Reels' },
  { v: 'telegram',   l: 'Telegram' },
  { v: 'whatsapp',   l: 'WhatsApp' },
  { v: 'avito',      l: 'Авито' },
  { v: 'site',       l: 'Сайт' },
  { v: 'youtube',    l: 'YouTube' },
]

const STATUSES = [
  { v: 'idea',       l: '💭 Идея',       cls: 'bg-slate-100 text-slate-600' },
  { v: 'in_progress',l: '✏️ В работе',   cls: 'bg-blue-100 text-blue-700' },
  { v: 'filmed',     l: '🎬 Снято',      cls: 'bg-amber-100 text-amber-700' },
  { v: 'editing',    l: '✂️ Монтаж',     cls: 'bg-purple-100 text-purple-700' },
  { v: 'published',  l: '✅ Опубликовано',cls: 'bg-emerald-100 text-emerald-700' },
]

const catLabel = (v: string) => CATEGORIES.find(c => c.v === v)?.l ?? v
const platLabel = (v: string) => PLATFORMS.find(p => p.v === v)?.l ?? v
const statusCfg = (v: string) => STATUSES.find(s => s.v === v) ?? { l: v, cls: 'bg-slate-100 text-slate-600' }

const EMPTY: Omit<ContentItem, 'id'> = {
  category: 'production', topic: '', goal: '', platform: 'instagram',
  hook: '', body: '', video_idea: '', cta: '', status: 'idea', publish_date: null,
}

export default function ContentPlanPage() {
  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [catFilter, setCatFilter] = useState('all')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [form, setForm] = useState<Omit<ContentItem, 'id'>>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/marketing/content')
    setItems(res.ok ? await res.json() : [])
    setLoading(false)
  }

  async function advanceStatus(item: ContentItem) {
    const order = STATUSES.map(s => s.v)
    const idx = order.indexOf(item.status)
    if (idx >= order.length - 1) return
    const next = order[idx + 1]
    await fetch('/api/marketing/content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, status: next }),
    })
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, status: next } : x))
  }

  function startEdit(item: ContentItem) {
    const { id, ...rest } = item
    setForm(rest)
    setEditId(id)
    setShowForm(true)
  }

  function startNew() {
    setForm(EMPTY)
    setEditId(null)
    setShowForm(true)
  }

  async function save() {
    if (!form.topic.trim()) return
    setSaving(true)
    const method = editId ? 'PUT' : 'POST'
    const body = editId ? { id: editId, ...form } : form
    await fetch('/api/marketing/content', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    setSaving(false)
    setShowForm(false)
    load()
  }

  async function del(id: number) {
    if (!confirm('Удалить?')) return
    await fetch('/api/marketing/content', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setItems(prev => prev.filter(x => x.id !== id))
  }

  const filtered = items.filter(x =>
    (statusFilter === 'all' || x.status === statusFilter) &&
    (catFilter === 'all' || x.category === catFilter)
  )

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Контент-план</h1>
          <p className="text-[13px] text-[#6b6b66] mt-1">{items.length} единиц контента</p>
        </div>
        <button onClick={startNew} className="flex-shrink-0 px-4 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] transition-colors">
          + Добавить
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] bg-white text-[#111110]">
          <option value="all">Все статусы</option>
          {STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] bg-white text-[#111110]">
          <option value="all">Все категории</option>
          {CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
        </select>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-2 mb-5">
        {STATUSES.map(s => {
          const cnt = items.filter(x => x.status === s.v).length
          return (
            <button key={s.v} onClick={() => setStatusFilter(statusFilter === s.v ? 'all' : s.v)}
              className={`text-[12px] px-3 py-1 rounded-full ${statusFilter === s.v ? s.cls + ' ring-2 ring-offset-1 ring-current' : s.cls}`}>
              {s.l} · {cnt}
            </button>
          )
        })}
      </div>

      {/* Items */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-16 text-[13px] text-[#8a8a85]">Нет записей. Нажмите «+ Добавить».</div>
        )}
        {filtered.map(item => (
          <div key={item.id} className="bg-white border border-[#e4e4e0] rounded-xl">
            <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusCfg(item.status).cls}`}>
                {statusCfg(item.status).l}
              </span>
              <span className="text-[13px] font-medium text-[#111110] truncate flex-1">{item.topic}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                {item.platform && <span className="text-[11px] bg-[#f0f0ec] text-[#6b6b66] px-2 py-0.5 rounded">{platLabel(item.platform)}</span>}
                <span className="text-[11px] bg-[#f5f5f0] text-[#6b6b66] px-2 py-0.5 rounded">{catLabel(item.category)}</span>
                <button onClick={e => { e.stopPropagation(); advanceStatus(item) }}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">
                  →
                </button>
                <button onClick={e => { e.stopPropagation(); startEdit(item) }}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">
                  Ред.
                </button>
                <button onClick={e => { e.stopPropagation(); del(item.id) }}
                  className="text-[11px] px-2 py-1 rounded-lg text-red-400 hover:text-red-600 transition-colors">✕</button>
                <span className="text-[#c0c0bb] text-sm">{expanded === item.id ? '▲' : '▼'}</span>
              </div>
            </div>
            {expanded === item.id && (
              <div className="border-t border-[#f0f0ec] px-4 pb-4 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-4 text-[12px]">
                {[
                  ['Цель', item.goal],
                  ['Хук', item.hook],
                  ['CTA', item.cta],
                  ['Идея видео', item.video_idea],
                  ['Дата', item.publish_date],
                ].map(([label, val]) => val ? (
                  <div key={label as string}>
                    <p className="text-[#8a8a85] font-medium mb-0.5">{label}</p>
                    <p className="text-[#111110] leading-relaxed">{val}</p>
                  </div>
                ) : null)}
                {item.body && (
                  <div className="sm:col-span-2">
                    <p className="text-[#8a8a85] font-medium mb-0.5">Текст поста</p>
                    <pre className="text-[#111110] leading-relaxed whitespace-pre-wrap font-sans bg-[#fafaf8] rounded-lg p-3">{item.body}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-5">{editId ? 'Редактировать' : 'Новая единица контента'}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Категория</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] bg-white">
                    {CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Платформа</label>
                  <select value={form.platform ?? ''} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] bg-white">
                    {PLATFORMS.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
                  </select>
                </div>
              </div>
              {[
                { key: 'topic', label: 'Тема *', placeholder: 'Как выбрать душевую: 5 ошибок' },
                { key: 'goal',  label: 'Цель',   placeholder: 'Показать экспертность, привлечь заявки' },
                { key: 'hook',  label: 'Хук',    placeholder: 'Почему 70% душевых приходится переделывать?' },
                { key: 'cta',   label: 'CTA',    placeholder: 'Напишите нам — рассчитаем за 5 минут' },
                { key: 'video_idea', label: 'Идея видео', placeholder: 'Съёмка в цеху, показываем стекло' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">{label}</label>
                  <input type="text" value={(form as Record<string, string | null>)[key] ?? ''}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              ))}
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Текст поста</label>
                <textarea value={form.body ?? ''} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  rows={4} placeholder="Полный текст для публикации..."
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Статус</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] bg-white">
                    {STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Дата публикации</label>
                  <input type="date" value={form.publish_date ?? ''}
                    onChange={e => setForm(f => ({ ...f, publish_date: e.target.value || null }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={save} disabled={saving}
                className="px-5 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 transition-colors">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={() => setShowForm(false)}
                className="px-5 py-2 border border-[#e4e4e0] rounded-xl text-[13px] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
