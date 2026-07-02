'use client'

import { useState, useEffect, useCallback } from 'react'

type Media = {
  id: number
  name: string
  type: string
  url: string | null
  thumbnail_url: string | null
  tags: string[]
  category: string | null
  description: string | null
  project_name: string | null
  created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  photo: 'Фото',
  video: 'Видео',
  b_roll: 'B-roll',
  graphic: 'Графика',
  audio: 'Аудио',
}

const CATEGORIES = [
  'shower', 'mirror', 'loft', 'office', 'production', 'install', 'team', 'object',
]

const CATEGORY_LABELS: Record<string, string> = {
  shower: 'Душевые', mirror: 'Зеркала', loft: 'Лофт', office: 'Офис',
  production: 'Производство', install: 'Монтаж', team: 'Команда', object: 'Объекты',
}

const POPULAR_TAGS = [
  'premium', 'before_after', 'process', 'detail', 'wide_shot', 'close_up',
  'b2b', 'moscow', 'exterior', 'interior',
]

function MediaCard({ item, onDelete, onUpdate }: {
  item: Media
  onDelete: (id: number) => void
  onUpdate: (id: number, fields: Partial<Media>) => void
}) {
  const [editTag, setEditTag] = useState('')
  const [editing, setEditing] = useState(false)

  function addTag() {
    const t = editTag.trim().toLowerCase()
    if (!t || item.tags.includes(t)) { setEditTag(''); return }
    onUpdate(item.id, { tags: [...item.tags, t] })
    setEditTag('')
  }

  function removeTag(tag: string) {
    onUpdate(item.id, { tags: item.tags.filter(t => t !== tag) })
  }

  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
      {/* Preview */}
      <div className="h-36 bg-[#f4f4f0] flex items-center justify-center relative">
        {item.thumbnail_url || item.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnail_url ?? item.url!}
            alt={item.name}
            className="w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <span className="text-[28px] text-[#c4c4c0]">
            {item.type === 'video' || item.type === 'b_roll' ? '🎬' : item.type === 'audio' ? '🎵' : '🖼'}
          </span>
        )}
        <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 bg-black/60 text-white rounded font-medium">
          {TYPE_LABELS[item.type] ?? item.type}
        </span>
      </div>

      <div className="p-3">
        {editing ? (
          <input
            autoFocus
            defaultValue={item.name}
            onBlur={e => { onUpdate(item.id, { name: e.target.value }); setEditing(false) }}
            className="w-full text-[13px] font-medium border border-blue-300 rounded px-2 py-0.5 focus:outline-none"
          />
        ) : (
          <p className="text-[13px] font-medium text-[#111110] truncate cursor-pointer" onClick={() => setEditing(true)}>
            {item.name}
          </p>
        )}

        {item.category && (
          <p className="text-[11px] text-[#8a8a85] mt-0.5">{CATEGORY_LABELS[item.category] ?? item.category}</p>
        )}
        {item.project_name && (
          <p className="text-[11px] text-[#8a8a85]">Объект: {item.project_name}</p>
        )}

        {/* Tags */}
        <div className="flex flex-wrap gap-1 mt-2">
          {item.tags.map(tag => (
            <span key={tag} className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-[#f4f4f0] text-[#6b6b66] rounded">
              {tag}
              <button onClick={() => removeTag(tag)} className="text-[#8a8a85] hover:text-red-500 ml-0.5">×</button>
            </span>
          ))}
          <div className="flex items-center gap-1">
            <input
              value={editTag}
              onChange={e => setEditTag(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTag() }}
              placeholder="+ тег"
              className="text-[10px] w-16 border border-[#e4e4e0] rounded px-1 py-0.5 focus:outline-none focus:border-blue-300"
            />
          </div>
        </div>

        {/* URL */}
        <div className="mt-2 flex gap-1">
          <input
            type="url"
            placeholder="URL файла..."
            defaultValue={item.url ?? ''}
            onBlur={e => onUpdate(item.id, { url: e.target.value || null })}
            className="flex-1 text-[11px] border border-[#e4e4e0] rounded px-2 py-1 focus:outline-none min-w-0"
          />
          <button onClick={() => onDelete(item.id)}
            className="text-[11px] px-2 py-1 rounded text-red-400 hover:bg-red-50 flex-shrink-0">
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

const EMPTY: Media = {
  id: 0, name: '', type: 'photo', url: null, thumbnail_url: null,
  tags: [], category: null, description: null, project_name: null, created_at: '',
}

export default function MediaLibraryPage() {
  const [items, setItems] = useState<Media[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Partial<Media>>(EMPTY)
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (filterType) params.set('type', filterType)
    if (filterTag) params.set('tag', filterTag)
    if (filterCategory) params.set('category', filterCategory)
    const res = await fetch(`/api/marketing/media?${params}`)
    const data = await res.json()
    setItems(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [filterType, filterTag, filterCategory])

  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  async function add() {
    if (!form.name?.trim()) return
    setSaving(true)
    const res = await fetch('/api/marketing/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, tags: form.tags ?? [] }),
    })
    if (res.ok) {
      const created = await res.json()
      setItems(prev => [created, ...prev])
      setForm(EMPTY)
      setTagInput('')
      setShowAdd(false)
    }
    setSaving(false)
  }

  async function update(id: number, fields: Partial<Media>) {
    await fetch('/api/marketing/media', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    })
    setItems(prev => prev.map(m => m.id === id ? { ...m, ...fields } : m))
  }

  async function del(id: number) {
    await fetch('/api/marketing/media', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setItems(prev => prev.filter(m => m.id !== id))
  }

  function addFormTag() {
    const t = tagInput.trim().toLowerCase()
    if (!t || form.tags?.includes(t)) { setTagInput(''); return }
    setForm(f => ({ ...f, tags: [...(f.tags ?? []), t] }))
    setTagInput('')
  }

  const allTags = Array.from(new Set(items.flatMap(m => m.tags)))

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Медиабиблиотека</h1>
          <p className="text-[13px] text-[#6b6b66] mt-0.5">Фото, видео, B-roll — всё для производства контента MGlass</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] transition-colors">
          + Добавить
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 mb-6 space-y-3">
          <p className="text-[13px] font-semibold text-[#111110]">Добавить медиафайл</p>
          <div className="grid grid-cols-3 gap-3">
            <input
              placeholder="Название *"
              value={form.name ?? ''}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="col-span-2 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <select value={form.type ?? 'photo'} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none">
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="URL файла"
              value={form.url ?? ''}
              onChange={e => setForm(f => ({ ...f, url: e.target.value || null }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none"
            />
            <input
              placeholder="URL превью"
              value={form.thumbnail_url ?? ''}
              onChange={e => setForm(f => ({ ...f, thumbnail_url: e.target.value || null }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select value={form.category ?? ''} onChange={e => setForm(f => ({ ...f, category: e.target.value || null }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none">
              <option value="">Категория...</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
            </select>
            <input
              placeholder="Название объекта/проекта"
              value={form.project_name ?? ''}
              onChange={e => setForm(f => ({ ...f, project_name: e.target.value || null }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none"
            />
          </div>

          {/* Tags */}
          <div>
            <p className="text-[11px] text-[#8a8a85] mb-1.5">Теги</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.tags?.map(t => (
                <span key={t} className="text-[11px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded flex items-center gap-1">
                  {t}
                  <button onClick={() => setForm(f => ({ ...f, tags: f.tags?.filter(x => x !== t) }))} className="hover:text-red-500">×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap">
              {POPULAR_TAGS.map(t => (
                <button key={t} onClick={() => {
                  if (!form.tags?.includes(t)) setForm(f => ({ ...f, tags: [...(f.tags ?? []), t] }))
                }}
                  className="text-[11px] px-2 py-0.5 border border-[#e4e4e0] rounded text-[#6b6b66] hover:border-blue-300 hover:text-blue-700 transition-colors">
                  {t}
                </button>
              ))}
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addFormTag() }}
                placeholder="+ свой тег"
                className="text-[11px] border border-[#e4e4e0] rounded px-2 py-0.5 focus:outline-none focus:border-blue-300 w-24"
              />
            </div>
          </div>

          <textarea
            placeholder="Описание (необязательно)"
            value={form.description ?? ''}
            onChange={e => setForm(f => ({ ...f, description: e.target.value || null }))}
            rows={2}
            className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none"
          />

          <div className="flex gap-2">
            <button onClick={add} disabled={!form.name?.trim() || saving}
              className="px-4 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] disabled:opacity-50">
              {saving ? 'Сохранение...' : 'Добавить'}
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-4 py-2 border border-[#e4e4e0] text-[#6b6b66] rounded-xl text-[13px] hover:bg-[#f4f4f0]">
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="flex gap-1">
          <button onClick={() => setFilterType('')}
            className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${!filterType ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#8a8a85]'}`}>
            Все
          </button>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <button key={k} onClick={() => setFilterType(filterType === k ? '' : k)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${filterType === k ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#8a8a85]'}`}>
              {v}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {allTags.slice(0, 12).map(tag => (
            <button key={tag} onClick={() => setFilterTag(filterTag === tag ? '' : tag)}
              className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${filterTag === tag ? 'bg-blue-600 text-white border-blue-600' : 'border-[#e4e4e0] text-[#8a8a85]'}`}>
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-[12px] text-[#8a8a85] mb-4">
        {Object.entries(TYPE_LABELS).map(([k, v]) => {
          const count = items.filter(m => m.type === k).length
          return count > 0 ? <span key={k}>{v}: {count}</span> : null
        })}
        <span className="font-medium text-[#6b6b66]">Итого: {items.length}</span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-16 text-[13px] text-[#8a8a85]">Загрузка...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-[13px] text-[#8a8a85]">
          Медиатека пуста. Добавьте первый файл.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map(m => (
            <MediaCard key={m.id} item={m} onUpdate={update} onDelete={del} />
          ))}
        </div>
      )}
    </div>
  )
}
