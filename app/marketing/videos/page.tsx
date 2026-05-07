'use client'

import { useEffect, useState } from 'react'

type Video = {
  id: number
  title: string
  hook: string | null
  problem: string | null
  structure: string | null
  narrator_text: string | null
  shots: string | null
  b_roll: string | null
  cta: string | null
  status: string
}

const STATUSES = [
  { v: 'idea',      l: '💭 Идея',       cls: 'bg-slate-100 text-slate-600' },
  { v: 'scripted',  l: '📝 Сценарий',   cls: 'bg-blue-100 text-blue-700' },
  { v: 'filming',   l: '🎥 Съёмка',     cls: 'bg-amber-100 text-amber-700' },
  { v: 'editing',   l: '✂️ Монтаж',     cls: 'bg-purple-100 text-purple-700' },
  { v: 'published', l: '✅ Опубликовано',cls: 'bg-emerald-100 text-emerald-700' },
]

const statusCfg = (v: string) => STATUSES.find(s => s.v === v) ?? { l: v, cls: 'bg-slate-100 text-slate-600' }

const EMPTY: Omit<Video, 'id'> = {
  title: '', hook: '', problem: '', structure: '', narrator_text: '', shots: '', b_roll: '', cta: '', status: 'idea',
}

const TEMPLATES = [
  {
    label: 'Ошибка клиента',
    data: {
      title: 'Почему душевую за 40 000 ₽ приходится переделывать',
      hook: 'Почему душевую за 40 000 ₽ приходится переделывать?',
      problem: 'Клиент выбирает дешёвую душевую → некачественное стекло → фурнитура ржавеет → переделка через 2 года',
      structure: '1. Показываем проблему (5 сек)\n2. Ошибка: выбор по цене, не по качеству (10 сек)\n3. Что скрыто в дешёвой душевой (10 сек)\n4. Как правильно выбирать (10 сек)\n5. Примеры MGlass (5 сек)\n6. CTA (5 сек)',
      narrator_text: 'Если вам предлагают душевую за 35-40 тысяч — знайте, на чём экономят. Стекло 4-5 мм вместо 8-го. Алюминий вместо нержавейки. Через 2 года это начнёт скрипеть, темнеть и протекать. Мы делаем только из закалённого стекла 8 и 10 мм. Это не дешевле. Это правильно. Запишитесь на замер — рассчитаем за 10 минут.',
      shots: '1. Крупно: ржавая фурнитура (чужой пример)\n2. Тонкое стекло vs толстое — сравнение в руках\n3. Наше производство: резка, полировка\n4. Готовая душевая в интерьере\n5. Лого MGlass + номер',
      b_roll: 'Цех, станки, стекло, готовые изделия',
      cta: 'Запишитесь на бесплатный замер',
    },
  },
  {
    label: 'До/После',
    data: {
      title: 'Ванная до и после: лофт-перегородка вместо занавески',
      hook: 'Занавеска в ванной в 2025 году — вот это неловко',
      problem: 'Клиент десятилетиями терпит занавеску, не зная что замена стоит разумно',
      structure: '1. Хук — занавеска (3 сек)\n2. "До" — фото с занавеской (5 сек)\n3. Замер и монтаж за день (10 сек)\n4. "После" — красивая душевая (10 сек)\n5. Цена (5 сек)\n6. CTA (5 сек)',
      narrator_text: 'Занавеска в ванной в 2025 году — это как дискета вместо флэшки. Стеклянная душевая от MGlass меняет всё пространство. Замер — бесплатно. Монтаж — за один день. А выглядит как в отеле. Напишите нам — пришлём примеры под ваш санузел.',
      shots: '"До" — занавеска, плитка. "После" — стеклянная душевая. Процесс монтажа 10-15 секунд.',
      b_roll: 'Руки монтажника, стекло блестит, клиент доволен',
      cta: 'Напишите нам — пришлём примеры',
    },
  },
]

export default function VideoFactoryPage() {
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [form, setForm] = useState<Omit<Video, 'id'>>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/marketing/videos')
    setVideos(res.ok ? await res.json() : [])
    setLoading(false)
  }

  async function advanceStatus(v: Video) {
    const order = STATUSES.map(s => s.v)
    const idx = order.indexOf(v.status)
    if (idx >= order.length - 1) return
    const next = order[idx + 1]
    await fetch('/api/marketing/videos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: v.id, status: next }) })
    setVideos(prev => prev.map(x => x.id === v.id ? { ...x, status: next } : x))
  }

  function applyTemplate(tpl: typeof TEMPLATES[0]) {
    setForm(f => ({ ...f, ...tpl.data }))
  }

  async function save() {
    if (!form.title.trim()) return
    setSaving(true)
    const method = editId ? 'PUT' : 'POST'
    const body = editId ? { id: editId, ...form } : form
    await fetch('/api/marketing/videos', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    setShowForm(false)
    load()
  }

  function copyScript(v: Video) {
    const text = [
      v.hook && `ХУКА: ${v.hook}`,
      v.problem && `ПРОБЛЕМА: ${v.problem}`,
      v.structure && `СТРУКТУРА:\n${v.structure}`,
      v.narrator_text && `ТЕКСТ ДИКТОРА:\n${v.narrator_text}`,
      v.shots && `КАДРЫ:\n${v.shots}`,
      v.b_roll && `B-ROLL: ${v.b_roll}`,
      v.cta && `CTA: ${v.cta}`,
    ].filter(Boolean).join('\n\n')
    navigator.clipboard.writeText(text)
    setCopied(v.id)
    setTimeout(() => setCopied(null), 2000)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Video Factory</h1>
          <p className="text-[13px] text-[#6b6b66] mt-1">Сценарии Reels и Shorts для MGlass</p>
        </div>
        <button onClick={() => { setForm(EMPTY); setEditId(null); setShowForm(true) }}
          className="flex-shrink-0 px-4 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] transition-colors">
          + Ролик
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        {STATUSES.map(s => {
          const cnt = videos.filter(v => v.status === s.v).length
          if (!cnt) return null
          return <span key={s.v} className={`text-[12px] px-3 py-1 rounded-full ${s.cls}`}>{s.l} · {cnt}</span>
        })}
      </div>

      <div className="space-y-3">
        {videos.length === 0 && <div className="text-center py-16 text-[13px] text-[#8a8a85]">Нет сценариев. Нажмите «+ Ролик».</div>}
        {videos.map(v => (
          <div key={v.id} className="bg-white border border-[#e4e4e0] rounded-xl">
            <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusCfg(v.status).cls}`}>
                {statusCfg(v.status).l}
              </span>
              <span className="text-[13px] font-medium text-[#111110] flex-1 truncate">{v.title}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={e => { e.stopPropagation(); copyScript(v) }}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">
                  {copied === v.id ? '✓' : 'Копировать'}
                </button>
                <button onClick={e => { e.stopPropagation(); advanceStatus(v) }}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">→</button>
                <button onClick={e => { e.stopPropagation(); const { id, ...rest } = v; setForm(rest); setEditId(v.id); setShowForm(true) }}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">Ред.</button>
                <button onClick={e => { e.stopPropagation(); if (!confirm('Удалить?')) return; fetch('/api/marketing/videos', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: v.id }) }); setVideos(prev => prev.filter(x => x.id !== v.id)) }}
                  className="text-[11px] px-2 py-1 text-red-400 hover:text-red-600 transition-colors">✕</button>
                <span className="text-[#c0c0bb] text-sm">{expanded === v.id ? '▲' : '▼'}</span>
              </div>
            </div>
            {expanded === v.id && (
              <div className="border-t border-[#f0f0ec] px-4 pb-4 pt-3 space-y-4">
                {v.hook && <div><p className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-wider mb-1">Хук</p><p className="text-[14px] font-semibold text-[#111110] leading-tight">"{v.hook}"</p></div>}
                {v.problem && <div><p className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-wider mb-1">Проблема</p><p className="text-[13px] text-[#6b6b66]">{v.problem}</p></div>}
                {v.structure && <div><p className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-wider mb-1">Структура</p><pre className="text-[13px] text-[#111110] whitespace-pre-wrap font-sans bg-[#fafaf8] rounded-lg p-3">{v.structure}</pre></div>}
                {v.narrator_text && <div><p className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-wider mb-1">Текст диктора</p><pre className="text-[13px] text-[#111110] whitespace-pre-wrap font-sans bg-amber-50 border border-amber-100 rounded-lg p-3 italic">{v.narrator_text}</pre></div>}
                {v.shots && <div><p className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-wider mb-1">Кадры</p><pre className="text-[13px] text-[#111110] whitespace-pre-wrap font-sans bg-[#fafaf8] rounded-lg p-3">{v.shots}</pre></div>}
                {v.b_roll && <div><p className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-wider mb-1">B-roll</p><p className="text-[13px] text-[#6b6b66]">{v.b_roll}</p></div>}
                {v.cta && <div><p className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-wider mb-1">CTA</p><p className="text-[13px] font-semibold text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{v.cta}</p></div>}
              </div>
            )}
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-2">{editId ? 'Редактировать сценарий' : 'Новый сценарий ролика'}</h2>
            {!editId && (
              <div className="flex gap-2 mb-4">
                <span className="text-[12px] text-[#8a8a85]">Шаблоны:</span>
                {TEMPLATES.map(tpl => (
                  <button key={tpl.label} onClick={() => applyTemplate(tpl)}
                    className="text-[12px] px-2.5 py-1 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors">
                    {tpl.label}
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-3">
              {[
                { k: 'title', l: 'Название *', r: 2 },
                { k: 'hook', l: 'Хук (первые 2 сек)', r: 2 },
                { k: 'problem', l: 'Проблема', r: 2 },
                { k: 'structure', l: 'Структура', r: 5 },
                { k: 'narrator_text', l: 'Текст диктора', r: 5 },
                { k: 'shots', l: 'Кадры', r: 4 },
                { k: 'b_roll', l: 'B-roll', r: 2 },
                { k: 'cta', l: 'CTA', r: 2 },
              ].map(({ k, l, r }) => (
                <div key={k}>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">{l}</label>
                  <textarea value={(form as Record<string, string | null>)[k] ?? ''} rows={r}
                    onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              ))}
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Статус</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] bg-white">
                  {STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
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
