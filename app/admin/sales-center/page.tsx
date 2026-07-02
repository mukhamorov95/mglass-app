'use client'

import { useEffect, useState } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────

type Script = {
  id: number
  category: string
  title: string
  trigger_desc: string | null
  body: string
  is_featured: boolean
  active: boolean
}

type KBArticle = {
  id: number
  category: string
  title: string
  content: string
  tags: string[]
  active: boolean
  sort_order: number
}

type Followup = {
  id: number
  name: string
  delay_days: number
  channel: string
  context: string
  body: string
  cta: string | null
  bonus_offer: string | null
  active: boolean
}

// ─── Script categories ──────────────────────────────────────────────────────

const SCRIPT_GROUPS = [
  {
    label: 'B2C — Продажи',
    categories: [
      { value: 'first_contact',       label: 'Первый контакт' },
      { value: 'needs_discovery',     label: 'Выявление потребности' },
      { value: 'price_presentation',  label: 'Презентация цены' },
      { value: 'objection_expensive', label: 'Возражение: дорого' },
      { value: 'objection_compare',   label: 'Возражение: конкуренты' },
      { value: 'objection_think',     label: 'Возражение: подумаю' },
      { value: 'measurement_close',   label: 'Закрытие на замер' },
      { value: 'followup',            label: 'Follow-up' },
      { value: 'no_answer',           label: 'Нет ответа' },
      { value: 'reactivation',        label: 'Реактивация' },
    ],
  },
  {
    label: 'Апселл',
    categories: [
      { value: 'upsell_glass',        label: 'Апселл: стекло' },
      { value: 'upsell_hardware',     label: 'Апселл: фурнитура' },
      { value: 'upsell_coating',      label: 'Апселл: покрытие' },
      { value: 'upsell_vip',          label: 'VIP клиент' },
      { value: 'upsell_second',       label: 'Второй заказ' },
    ],
  },
  {
    label: 'B2B',
    categories: [
      { value: 'b2b_first',           label: 'B2B: первый контакт' },
      { value: 'b2b_designer',        label: 'B2B: дизайнер' },
      { value: 'b2b_furniture',       label: 'B2B: мебельные' },
      { value: 'b2b_construction',    label: 'B2B: строители' },
      { value: 'b2b_volume',          label: 'B2B: объёмный заказ' },
      { value: 'b2b_proposal',        label: 'B2B: отправка КП' },
      { value: 'b2b_followup',        label: 'B2B: follow-up' },
      { value: 'b2b_partnership',     label: 'B2B: оформление партнёрства' },
    ],
  },
  {
    label: 'Партнёры',
    categories: [
      { value: 'partner_referral',    label: 'Реферальная программа' },
      { value: 'partner_dealer',      label: 'Дилерская программа' },
      { value: 'partner_onboarding',  label: 'Онбординг партнёра' },
      { value: 'partner_activate',    label: 'Активация спящего партнёра' },
      { value: 'partner_review',      label: 'Запрос отзыва / кейса' },
    ],
  },
]

const ALL_CATEGORIES = SCRIPT_GROUPS.flatMap(g => g.categories)
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(ALL_CATEGORIES.map(c => [c.value, c.label]))

const KB_CATEGORIES = [
  { value: '', label: 'Все' },
  { value: 'glass',        label: 'Стекло' },
  { value: 'hardware',     label: 'Фурнитура' },
  { value: 'installation', label: 'Монтаж' },
  { value: 'pricing',      label: 'Ценообразование' },
  { value: 'competitors',  label: 'Конкуренты' },
  { value: 'b2b',          label: 'B2B' },
  { value: 'objections',   label: 'Возражения' },
  { value: 'guarantee',    label: 'Гарантия' },
]

const FOLLOWUP_CONTEXTS = [
  { value: '',                  label: 'Все' },
  { value: 'after_quote',       label: 'После КП' },
  { value: 'no_answer',         label: 'Нет ответа' },
  { value: 'price_objection',   label: 'Возражение по цене' },
  { value: 'measurement_done',  label: 'После замера' },
  { value: 'general',           label: 'Общие' },
]

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: '💬',
  telegram: '✈️',
  call: '📞',
  email: '📧',
}

// ─── Tab type ───────────────────────────────────────────────────────────────

type Tab = 'scripts' | 'knowledge' | 'followup' | 'training' | 'blindzones'

// ─── Main page ──────────────────────────────────────────────────────────────

export default function SalesCenterPage() {
  const [tab, setTab] = useState<Tab>('scripts')

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-1">Только для владельца</p>
        <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Sales Center</h1>
        <p className="text-[13px] text-[#6b6b66] mt-1">
          Скрипты, база знаний, follow-up шаблоны, обучение и слепые зоны
        </p>
      </div>

      <div className="flex gap-1 mb-6 bg-[#f5f5f0] rounded-xl p-1 w-fit flex-wrap">
        {([
          ['scripts',    'Скрипты'],
          ['knowledge',  'База знаний'],
          ['followup',   'Follow-up'],
          ['training',   'Обучение'],
          ['blindzones', 'Слепые зоны'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
              tab === t ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66] hover:text-[#111110]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'scripts'    && <ScriptsTab />}
      {tab === 'knowledge'  && <KnowledgeTab />}
      {tab === 'followup'   && <FollowupTab />}
      {tab === 'training'   && <TrainingTab />}
      {tab === 'blindzones' && <BlindZonesTab />}
    </div>
  )
}

// ─── Scripts Tab ────────────────────────────────────────────────────────────

const EMPTY_SCRIPT: Omit<Script, 'id'> = {
  category: 'first_contact', title: '', trigger_desc: '', body: '', is_featured: false, active: true,
}

function ScriptsTab() {
  const [scripts, setScripts]         = useState<Script[]>([])
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState<number | null>(null)
  const [filterGroup, setFilterGroup] = useState<string>('')
  const [form, setForm]               = useState<Omit<Script, 'id'>>(EMPTY_SCRIPT)
  const [editId, setEditId]           = useState<number | null>(null)
  const [showForm, setShowForm]       = useState(false)
  const [saving, setSaving]           = useState(false)
  const [copied, setCopied]           = useState<number | null>(null)

  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/admin/sales-scripts')
    setScripts(res.ok ? await res.json() : [])
    setLoading(false)
  }

  async function toggle(s: Script, field: 'active' | 'is_featured') {
    await fetch('/api/admin/sales-scripts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, [field]: !s[field] }),
    })
    setScripts(prev => prev.map(x => x.id === s.id ? { ...x, [field]: !x[field] } : x))
  }

  function startEdit(s: Script) {
    setForm({ category: s.category, title: s.title, trigger_desc: s.trigger_desc ?? '', body: s.body, is_featured: s.is_featured, active: s.active })
    setEditId(s.id)
    setShowForm(true)
  }

  async function save() {
    if (!form.title.trim() || !form.body.trim()) return
    setSaving(true)
    await fetch('/api/admin/sales-scripts', {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editId ? { id: editId, ...form } : form),
    })
    setSaving(false)
    setShowForm(false)
    load()
  }

  async function del(id: number) {
    if (!confirm('Удалить скрипт?')) return
    await fetch('/api/admin/sales-scripts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setScripts(prev => prev.filter(s => s.id !== id))
  }

  function copy(s: Script) {
    navigator.clipboard.writeText(s.body)
    setCopied(s.id)
    setTimeout(() => setCopied(null), 2000)
  }

  const visibleGroups = filterGroup
    ? SCRIPT_GROUPS.filter(g => g.label === filterGroup)
    : SCRIPT_GROUPS

  if (loading) return <div className="py-16 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilterGroup('')}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${!filterGroup ? 'bg-[#111110] text-white' : 'bg-[#f5f5f0] text-[#6b6b66] hover:text-[#111110]'}`}
          >Все</button>
          {SCRIPT_GROUPS.map(g => (
            <button
              key={g.label}
              onClick={() => setFilterGroup(filterGroup === g.label ? '' : g.label)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${filterGroup === g.label ? 'bg-[#111110] text-white' : 'bg-[#f5f5f0] text-[#6b6b66] hover:text-[#111110]'}`}
            >{g.label}</button>
          ))}
        </div>
        <button
          onClick={() => { setForm(EMPTY_SCRIPT); setEditId(null); setShowForm(true) }}
          className="flex-shrink-0 px-4 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] transition-colors"
        >+ Скрипт</button>
      </div>

      <div className="space-y-8">
        {visibleGroups.map(group => {
          const groupScripts = scripts.filter(s => group.categories.some(c => c.value === s.category))
          if (!groupScripts.length) return null
          const byCat = groupScripts.reduce<Record<string, Script[]>>((acc, s) => { ;(acc[s.category] ??= []).push(s); return acc }, {})
          return (
            <div key={group.label}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[12px] font-bold text-[#111110] uppercase tracking-wider">{group.label}</span>
                <div className="flex-1 h-px bg-[#e4e4e0]" />
                <span className="text-[11px] text-[#8a8a85]">{groupScripts.length} скриптов</span>
              </div>
              <div className="space-y-5">
                {group.categories.map(cat => {
                  const items = byCat[cat.value]
                  if (!items?.length) return null
                  return (
                    <div key={cat.value}>
                      <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-2">{cat.label}</p>
                      <div className="space-y-2">
                        {items.map(s => (
                          <div key={s.id} className={`bg-white border rounded-xl transition-opacity ${s.active ? 'border-[#e4e4e0]' : 'border-[#f0f0ec] opacity-50'}`}>
                            <div className="flex items-center justify-between gap-3 p-4 cursor-pointer" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                              <div className="flex items-center gap-2 min-w-0">
                                {s.is_featured && <span className="text-amber-400 text-sm flex-shrink-0">★</span>}
                                <span className="text-[13px] font-medium text-[#111110] truncate">{s.title}</span>
                                {s.trigger_desc && <span className="hidden sm:block text-[12px] text-[#8a8a85] truncate">— {s.trigger_desc}</span>}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <button onClick={e => { e.stopPropagation(); copy(s) }} className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">
                                  {copied === s.id ? '✓' : 'Копировать'}
                                </button>
                                <button onClick={e => { e.stopPropagation(); toggle(s, 'is_featured') }} className={`text-[11px] px-2 py-1 rounded-lg transition-colors ${s.is_featured ? 'text-amber-500' : 'text-[#c0c0bb] hover:text-amber-400'}`}>★</button>
                                <button onClick={e => { e.stopPropagation(); startEdit(s) }} className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">Ред.</button>
                                <button onClick={e => { e.stopPropagation(); toggle(s, 'active') }} className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">{s.active ? 'Откл.' : 'Вкл.'}</button>
                                <button onClick={e => { e.stopPropagation(); del(s.id) }} className="text-[11px] px-2 py-1 rounded-lg text-red-400 hover:text-red-600 transition-colors">✕</button>
                                <span className="text-[#c0c0bb] text-sm">{expanded === s.id ? '▲' : '▼'}</span>
                              </div>
                            </div>
                            {expanded === s.id && (
                              <div className="border-t border-[#f0f0ec] px-4 pb-4 pt-3">
                                {s.trigger_desc && (
                                  <p className="text-[12px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                                    <span className="font-semibold">Когда использовать:</span> {s.trigger_desc}
                                  </p>
                                )}
                                <pre className="text-[13px] text-[#111110] leading-relaxed whitespace-pre-wrap font-sans bg-[#fafaf8] rounded-lg p-4">{s.body}</pre>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {scripts.length === 0 && (
          <div className="text-center py-16 text-[13px] text-[#8a8a85]">Нет скриптов. Нажмите «+ Скрипт» чтобы добавить первый.</div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-5">{editId ? 'Изменить скрипт' : 'Новый скрипт'}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Категория</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
                    {SCRIPT_GROUPS.map(g => (
                      <optgroup key={g.label} label={g.label}>
                        {g.categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Название</label>
                  <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Первый ответ на запрос цены"
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Когда использовать</label>
                <input type="text" value={form.trigger_desc ?? ''} onChange={e => setForm(f => ({ ...f, trigger_desc: e.target.value }))}
                  placeholder="Клиент написал 'сколько стоит' без деталей"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Текст скрипта</label>
                <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  rows={8} placeholder="Введите текст скрипта..."
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono" />
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

// ─── Knowledge Base Tab ─────────────────────────────────────────────────────

const EMPTY_KB: Omit<KBArticle, 'id'> = {
  category: 'glass', title: '', content: '', tags: [], active: true, sort_order: 0,
}

function KnowledgeTab() {
  const [articles, setArticles]   = useState<KBArticle[]>([])
  const [loading, setLoading]     = useState(true)
  const [catFilter, setCatFilter] = useState('')
  const [expanded, setExpanded]   = useState<number | null>(null)
  const [form, setForm]           = useState<Omit<KBArticle, 'id'>>(EMPTY_KB)
  const [editId, setEditId]       = useState<number | null>(null)
  const [showForm, setShowForm]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [tagInput, setTagInput]   = useState('')

  useEffect(() => { load().catch(() => setLoading(false)) }, [catFilter])

  async function load() {
    setLoading(true)
    const q = catFilter ? `?category=${catFilter}` : ''
    const res = await fetch(`/api/admin/knowledge-base${q}`)
    setArticles(res.ok ? await res.json() : [])
    setLoading(false)
  }

  async function save() {
    if (!form.title.trim() || !form.content.trim()) return
    setSaving(true)
    await fetch('/api/admin/knowledge-base', {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editId ? { id: editId, ...form } : form),
    })
    setSaving(false)
    setShowForm(false)
    load()
  }

  async function del(id: number) {
    if (!confirm('Удалить статью?')) return
    await fetch('/api/admin/knowledge-base', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setArticles(prev => prev.filter(a => a.id !== id))
  }

  function startEdit(a: KBArticle) {
    setForm({ category: a.category, title: a.title, content: a.content, tags: a.tags, active: a.active, sort_order: a.sort_order })
    setTagInput(a.tags.join(', '))
    setEditId(a.id)
    setShowForm(true)
  }

  if (loading) return <div className="py-16 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex gap-1 flex-wrap">
          {KB_CATEGORIES.map(c => (
            <button key={c.value} onClick={() => setCatFilter(c.value)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${catFilter === c.value ? 'bg-[#111110] text-white' : 'bg-[#f5f5f0] text-[#6b6b66] hover:text-[#111110]'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <button onClick={() => { setForm(EMPTY_KB); setTagInput(''); setEditId(null); setShowForm(true) }}
          className="flex-shrink-0 px-4 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] transition-colors">
          + Статья
        </button>
      </div>

      <div className="space-y-2">
        {articles.map(a => (
          <div key={a.id} className="bg-white border border-[#e4e4e0] rounded-xl">
            <div className="flex items-center justify-between gap-3 p-4 cursor-pointer" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f5f5f0] text-[#6b6b66] flex-shrink-0">
                  {KB_CATEGORIES.find(c => c.value === a.category)?.label ?? a.category}
                </span>
                <span className="text-[13px] font-medium text-[#111110] truncate">{a.title}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={e => { e.stopPropagation(); startEdit(a) }}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">Ред.</button>
                <button onClick={e => { e.stopPropagation(); del(a.id) }}
                  className="text-[11px] px-2 py-1 rounded-lg text-red-400 hover:text-red-600 transition-colors">✕</button>
                <span className="text-[#c0c0bb] text-sm">{expanded === a.id ? '▲' : '▼'}</span>
              </div>
            </div>
            {expanded === a.id && (
              <div className="border-t border-[#f0f0ec] px-4 pb-4 pt-3">
                <p className="text-[13px] text-[#111110] leading-relaxed whitespace-pre-wrap">{a.content}</p>
                {a.tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mt-3">
                    {a.tags.map(t => (
                      <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {articles.length === 0 && (
          <div className="text-center py-16 text-[13px] text-[#8a8a85]">Нет статей в выбранной категории.</div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-5">{editId ? 'Изменить статью' : 'Новая статья'}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Категория</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
                    {KB_CATEGORIES.filter(c => c.value).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Порядок</label>
                  <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: +e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Заголовок</label>
                <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Закалённое стекло vs обычное"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Содержание</label>
                <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  rows={6} placeholder="Объяснение, факты, аргументы для менеджера..."
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Теги (через запятую)</label>
                <input type="text" value={tagInput} onChange={e => {
                  setTagInput(e.target.value)
                  setForm(f => ({ ...f, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }))
                }}
                  placeholder="стекло, безопасность, закалка"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
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

// ─── Follow-up Tab ──────────────────────────────────────────────────────────

const EMPTY_FOLLOWUP: Omit<Followup, 'id'> = {
  name: '', delay_days: 1, channel: 'whatsapp', context: 'after_quote', body: '', cta: '', bonus_offer: '', active: true,
}

function FollowupTab() {
  const [followups, setFollowups]   = useState<Followup[]>([])
  const [loading, setLoading]       = useState(true)
  const [ctxFilter, setCtxFilter]   = useState('')
  const [expanded, setExpanded]     = useState<number | null>(null)
  const [form, setForm]             = useState<Omit<Followup, 'id'>>(EMPTY_FOLLOWUP)
  const [editId, setEditId]         = useState<number | null>(null)
  const [showForm, setShowForm]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [copied, setCopied]         = useState<number | null>(null)

  useEffect(() => { load().catch(() => setLoading(false)) }, [ctxFilter])

  async function load() {
    setLoading(true)
    const q = ctxFilter ? `?context=${ctxFilter}` : ''
    const res = await fetch(`/api/admin/sales-followups${q}`)
    setFollowups(res.ok ? await res.json() : [])
    setLoading(false)
  }

  async function save() {
    if (!form.name.trim() || !form.body.trim()) return
    setSaving(true)
    await fetch('/api/admin/sales-followups', {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editId ? { id: editId, ...form } : form),
    })
    setSaving(false)
    setShowForm(false)
    load()
  }

  async function del(id: number) {
    if (!confirm('Удалить шаблон?')) return
    await fetch('/api/admin/sales-followups', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setFollowups(prev => prev.filter(f => f.id !== id))
  }

  function copy(f: Followup) {
    navigator.clipboard.writeText(f.body)
    setCopied(f.id)
    setTimeout(() => setCopied(null), 2000)
  }

  function startEdit(f: Followup) {
    setForm({ name: f.name, delay_days: f.delay_days, channel: f.channel, context: f.context, body: f.body, cta: f.cta ?? '', bonus_offer: f.bonus_offer ?? '', active: f.active })
    setEditId(f.id)
    setShowForm(true)
  }

  if (loading) return <div className="py-16 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex gap-1 flex-wrap">
          {FOLLOWUP_CONTEXTS.map(c => (
            <button key={c.value} onClick={() => setCtxFilter(c.value)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${ctxFilter === c.value ? 'bg-[#111110] text-white' : 'bg-[#f5f5f0] text-[#6b6b66] hover:text-[#111110]'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <button onClick={() => { setForm(EMPTY_FOLLOWUP); setEditId(null); setShowForm(true) }}
          className="flex-shrink-0 px-4 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] transition-colors">
          + Шаблон
        </button>
      </div>

      <div className="space-y-3">
        {followups.map(f => (
          <div key={f.id} className="bg-white border border-[#e4e4e0] rounded-xl">
            <div className="flex items-center justify-between gap-3 p-4 cursor-pointer" onClick={() => setExpanded(expanded === f.id ? null : f.id)}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-lg flex-shrink-0">{CHANNEL_ICONS[f.channel] ?? '📨'}</span>
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-[#111110] block truncate">{f.name}</span>
                  <span className="text-[11px] text-[#8a8a85]">День {f.delay_days} · {FOLLOWUP_CONTEXTS.find(c => c.value === f.context)?.label ?? f.context}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={e => { e.stopPropagation(); copy(f) }}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">
                  {copied === f.id ? '✓' : 'Копировать'}
                </button>
                <button onClick={e => { e.stopPropagation(); startEdit(f) }}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">Ред.</button>
                <button onClick={e => { e.stopPropagation(); del(f.id) }}
                  className="text-[11px] px-2 py-1 rounded-lg text-red-400 hover:text-red-600 transition-colors">✕</button>
                <span className="text-[#c0c0bb] text-sm">{expanded === f.id ? '▲' : '▼'}</span>
              </div>
            </div>
            {expanded === f.id && (
              <div className="border-t border-[#f0f0ec] px-4 pb-4 pt-3 space-y-3">
                <pre className="text-[13px] text-[#111110] leading-relaxed whitespace-pre-wrap font-sans bg-[#fafaf8] rounded-lg p-4">{f.body}</pre>
                {f.cta && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-[#6b6b66] uppercase tracking-wider">CTA:</span>
                    <span className="text-[13px] text-[#111110]">{f.cta}</span>
                  </div>
                )}
                {f.bonus_offer && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Бонус:</span>
                    <span className="text-[13px] text-emerald-800">{f.bonus_offer}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {followups.length === 0 && (
          <div className="text-center py-16 text-[13px] text-[#8a8a85]">Нет шаблонов. Нажмите «+ Шаблон» чтобы добавить первый.</div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-5">{editId ? 'Изменить шаблон' : 'Новый шаблон'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Название</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="После КП — день 1"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">День</label>
                  <input type="number" value={form.delay_days} onChange={e => setForm(f => ({ ...f, delay_days: +e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Канал</label>
                  <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="whatsapp">WhatsApp</option>
                    <option value="telegram">Telegram</option>
                    <option value="call">Звонок</option>
                    <option value="email">Email</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Контекст</label>
                  <select value={form.context} onChange={e => setForm(f => ({ ...f, context: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
                    {FOLLOWUP_CONTEXTS.filter(c => c.value).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Текст сообщения</label>
                <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  rows={6} placeholder="Добрый день, [Имя]! ..."
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">CTA (призыв к действию)</label>
                  <input type="text" value={form.cta ?? ''} onChange={e => setForm(f => ({ ...f, cta: e.target.value }))}
                    placeholder="Когда удобно пообщаться?"
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Бонус-оффер</label>
                  <input type="text" value={form.bonus_offer ?? ''} onChange={e => setForm(f => ({ ...f, bonus_offer: e.target.value }))}
                    placeholder="Бесплатный замер без обязательств"
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
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

// ─── Training Tab ───────────────────────────────────────────────────────────

const MISTAKES = [
  { title: 'Называть цену без контекста', fix: 'Сначала задай 2-3 уточняющих вопроса. Цена без размеров и конфигурации — это число без смысла. Клиент услышит "дорого" потому что не понимает за что платит.' },
  { title: 'Говорить "не знаю" и замолкать', fix: 'Правильный ответ: "Уточню у производства и напишу вам через [время]". Незнание — не проблема, молчание — проблема.' },
  { title: 'Давить при отказе', fix: 'Если клиент сказал "не сейчас" — прими спокойно, предложи написать если понадобится. Давление убивает доверие навсегда.' },
  { title: 'Предлагать скидку сразу', fix: 'Скидка — последний инструмент. Сначала объяснить ценность, найти альтернативу в бюджете. Если сразу дать скидку — клиент решит что изначальная цена была завышена.' },
  { title: 'Писать стены текста', fix: 'Максимум 3-4 коротких абзаца. Длинные сообщения не читают. Ключевую мысль — в первые 2 строки.' },
  { title: 'Игнорировать эмоцию клиента', fix: 'Если клиент раздражён или расстроен — сначала признай чувства: "Понимаю, это неприятная ситуация". Потом решай проблему.' },
]

const CLIENT_TACTICS = [
  { type: 'Горячий', color: 'border-l-emerald-400', signs: 'Есть размеры, называет сроки, просит точную цену', tactic: 'Считаем быстро, предлагаем замер сегодня/завтра. Не тянем, не рассказываем лишнего — человек готов.' },
  { type: 'Сравниватель', color: 'border-l-blue-400', signs: 'Сравнивает с конкурентами, спрашивает "чем вы лучше"', tactic: 'Не критикуем других. Рассказываем про своё: собственное производство, только закалёнка, гарантия 2 года. Спрашиваем: "А у других вы уточняли про гарантию и тип стекла?"' },
  { type: 'Бюджетный', color: 'border-l-amber-400', signs: 'Называет маленький бюджет, просит "самый дешёвый вариант"', tactic: 'Не отказываем. Предлагаем базовую серию с честным объяснением что входит. Иногда достаточно чуть скорректировать размер или конфигурацию.' },
  { type: 'VIP / дизайнер', color: 'border-l-purple-400', signs: 'Говорит про стиль, дорогой ЖК, упоминает дизайнера', tactic: 'Не скриптуем. Спрашиваем про проект, слушаем. Предлагаем Crystal Vision и premium фурнитуру как само собой разумеющееся.' },
  { type: 'Молчун', color: 'border-l-slate-400', signs: 'Написал раз и пропал, или отвечает очень коротко', tactic: 'Лёгкий follow-up через 2-3 дня. Один раз. Не преследуем — если не отвечает дважды, закрываем и не пишем.' },
]

function TrainingTab() {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#e4e4e0] rounded-xl p-5">
        <h3 className="text-[14px] font-semibold text-[#111110] mb-1">6 ошибок менеджера и как их исправить</h3>
        <p className="text-[12px] text-[#8a8a85] mb-4">Разобрать с командой на еженедельном разборе звонков</p>
        <div className="space-y-4">
          {MISTAKES.map((m, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-[11px] font-bold text-red-500">{i + 1}</div>
              <div>
                <p className="text-[13px] font-semibold text-red-700 mb-1">✕ {m.title}</p>
                <p className="text-[13px] text-[#6b6b66]"><span className="font-semibold text-emerald-700">✓ Как надо: </span>{m.fix}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-xl p-5">
        <h3 className="text-[14px] font-semibold text-[#111110] mb-1">Тактика по типу клиента</h3>
        <p className="text-[12px] text-[#8a8a85] mb-4">Определяй тип в первых 2-3 сообщениях — тактика зависит от этого</p>
        <div className="space-y-4">
          {CLIENT_TACTICS.map(c => (
            <div key={c.type} className={`pl-4 border-l-4 ${c.color}`}>
              <p className="text-[13px] font-semibold text-[#111110]">{c.type}</p>
              <p className="text-[12px] text-[#8a8a85] mb-1"><span className="font-medium text-[#6b6b66]">Признаки: </span>{c.signs}</p>
              <p className="text-[13px] text-[#6b6b66]">{c.tactic}</p>
            </div>
          ))}
        </div>
      </div>

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
            <div key={String(title)} className="flex items-start gap-3">
              <span className="flex-shrink-0 text-base">{icon}</span>
              <div>
                <span className="text-[13px] font-semibold text-blue-900">{title}: </span>
                <span className="text-[13px] text-blue-800">{desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Blind Zones Tab ────────────────────────────────────────────────────────

const BLIND_ZONES = [
  {
    severity: 'red',
    title: 'Нет системы B2B-развития',
    desc: 'Дизайнеры и строители могут давать повторяющийся поток заказов, но к ним нет систематического подхода. Один партнёр = потенциально 5-20 заказов в год.',
    action: 'Завести B2B CRM, назначить ответственного, поставить KPI по количеству активных B2B партнёров.',
  },
  {
    severity: 'red',
    title: 'Скрипты не обновляются после проигрышей',
    desc: 'Когда клиент уходит к конкуренту — причина не анализируется. Скрипты не адаптируются. Одни и те же ошибки повторяются.',
    action: 'Разбор проигранных сделок раз в месяц. Фиксировать частые причины и обновлять скрипты возражений.',
  },
  {
    severity: 'red',
    title: 'Отсутствует follow-up система',
    desc: 'Большинство клиентов не покупают в первый день. Без системного follow-up теряется 40-60% тёплых лидов.',
    action: 'Внедрить шаблоны follow-up с конкретными триггерами и днями. Контролировать выполнение.',
  },
  {
    severity: 'amber',
    title: 'Менеджеры не знают продукт глубоко',
    desc: 'Клиент задаёт вопрос про Crystal Vision или разницу петель — менеджер теряется. Это разрушает доверие.',
    action: 'Еженедельный 15-минутный продукт-брифинг. База знаний в Sales Center — обязательно читать.',
  },
  {
    severity: 'amber',
    title: 'Цена называется до выявления потребности',
    desc: 'Когда клиент слышит цену без понимания ценности — он сравнивает только числа. Побеждает дешевейший.',
    action: 'Обязательный порядок: потребность → решение → ценность → цена. Отработать на ролевых играх.',
  },
  {
    severity: 'amber',
    title: 'Нет апселл-системы',
    desc: 'Клиент покупает базовый вариант, хотя готов был взять лучше — никто не предложил. Средний чек остаётся на минимуме.',
    action: 'После согласования базы — всегда предложить одно улучшение. "Хотите посмотреть на вариант с матовым чёрным?"',
  },
  {
    severity: 'amber',
    title: 'Повторные клиенты не отрабатываются',
    desc: 'Клиент сделал заказ год назад — его не контактируют. А у него мог появиться новый объект или знакомый.',
    action: 'CRM с датой заказа. Раз в 6 месяцев — тёплое сообщение старым клиентам.',
  },
  {
    severity: 'blue',
    title: 'Нет системы отзывов',
    desc: 'Довольные клиенты есть, но их отзывов никто не собирает. Социальное доказательство не работает на полную.',
    action: 'После завершения монтажа — через 3-5 дней попросить отзыв. Скрипт прилагается в follow-up шаблонах.',
  },
  {
    severity: 'blue',
    title: 'Слабая квалификация лида на входе',
    desc: 'Менеджер тратит час на клиента, который хочет "просто узнать цену" без намерения покупать.',
    action: 'В первых двух сообщениях — задать квалификационные вопросы: объект, сроки, бюджет. Без ответа — не углубляться.',
  },
  {
    severity: 'blue',
    title: 'Нет измерения конверсии по менеджерам',
    desc: 'Непонятно кто из команды конвертирует лучше и почему. Лучший опыт не тиражируется.',
    action: 'Считать: лидов / замеров / оплат по каждому менеджеру. Раз в месяц — разбор показателей.',
  },
]

const SEVERITY_STYLE: Record<string, { badge: string; border: string; dot: string }> = {
  red:   { badge: 'bg-red-100 text-red-700',    border: 'border-red-200',   dot: 'bg-red-400' },
  amber: { badge: 'bg-amber-100 text-amber-700', border: 'border-amber-200', dot: 'bg-amber-400' },
  blue:  { badge: 'bg-blue-100 text-blue-700',   border: 'border-blue-200',  dot: 'bg-blue-400' },
}

const SEVERITY_LABEL: Record<string, string> = {
  red:   'Критично',
  amber: 'Важно',
  blue:  'Потенциал',
}

function BlindZonesTab() {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [filter, setFilter] = useState<string>('')

  const visible = filter ? BLIND_ZONES.filter(z => z.severity === filter) : BLIND_ZONES

  return (
    <div>
      <div className="bg-[#fafaf8] border border-[#e4e4e0] rounded-xl p-4 mb-5 text-[13px] text-[#6b6b66]">
        Это не чек-лист — это зоны где MGlass теряет деньги прямо сейчас. Каждый пункт — конкретная проблема с конкретным действием.
      </div>

      <div className="flex gap-1 mb-5">
        <button onClick={() => setFilter('')} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${!filter ? 'bg-[#111110] text-white' : 'bg-[#f5f5f0] text-[#6b6b66]'}`}>Все ({BLIND_ZONES.length})</button>
        {['red', 'amber', 'blue'].map(s => (
          <button key={s} onClick={() => setFilter(filter === s ? '' : s)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${filter === s ? 'bg-[#111110] text-white' : 'bg-[#f5f5f0] text-[#6b6b66]'}`}>
            {SEVERITY_LABEL[s]} ({BLIND_ZONES.filter(z => z.severity === s).length})
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {visible.map((z, i) => {
          const idx = BLIND_ZONES.indexOf(z)
          const st = SEVERITY_STYLE[z.severity]
          return (
            <div key={i} className={`bg-white border rounded-xl ${st.border}`}>
              <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpanded(expanded === idx ? null : idx)}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${st.dot}`} />
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${st.badge}`}>{SEVERITY_LABEL[z.severity]}</span>
                <span className="text-[13px] font-medium text-[#111110] flex-1 truncate">{z.title}</span>
                <span className="text-[#c0c0bb] text-sm flex-shrink-0">{expanded === idx ? '▲' : '▼'}</span>
              </div>
              {expanded === idx && (
                <div className="border-t border-[#f0f0ec] px-4 pb-4 pt-3 space-y-3">
                  <p className="text-[13px] text-[#6b6b66] leading-relaxed">{z.desc}</p>
                  <div className="bg-[#f5f5f0] rounded-lg px-4 py-3">
                    <p className="text-[11px] font-bold text-[#111110] uppercase tracking-wider mb-1">Что делать</p>
                    <p className="text-[13px] text-[#111110] leading-relaxed">{z.action}</p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
