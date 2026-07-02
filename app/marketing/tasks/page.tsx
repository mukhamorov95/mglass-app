'use client'

import { useEffect, useState } from 'react'
import { PageHeader, SelectField, EmptyState, Field } from '@/components/ds'

type Task = {
  id: number
  title: string
  direction: string
  priority: string
  assignee: string | null
  deadline: string | null
  status: string
  result: string | null
}

const DIRECTIONS = [
  { v: 'b2c',      l: 'B2C',       cls: 'bg-blue-100 text-blue-700' },
  { v: 'b2b',      l: 'B2B',       cls: 'bg-purple-100 text-purple-700' },
  { v: 'partners', l: 'Партнёры',  cls: 'bg-emerald-100 text-emerald-700' },
  { v: 'content',  l: 'Контент',   cls: 'bg-amber-100 text-amber-700' },
  { v: 'brand',    l: 'Бренд',     cls: 'bg-rose-100 text-rose-700' },
]

const PRIORITIES = [
  { v: 'urgent', l: '🔥 Срочно',  cls: 'bg-red-100 text-red-700' },
  { v: 'high',   l: '⬆️ Высокий', cls: 'bg-orange-100 text-orange-700' },
  { v: 'normal', l: '➡️ Обычный', cls: 'bg-slate-100 text-slate-600' },
  { v: 'low',    l: '⬇️ Низкий',  cls: 'bg-line-soft text-muted' },
]

const STATUSES = [
  { v: 'todo',        l: '☐ К выполнению' },
  { v: 'in_progress', l: '⚙️ В работе' },
  { v: 'done',        l: '✅ Выполнено' },
  { v: 'cancelled',   l: '✕ Отменено' },
]

const dirCfg = (v: string) => DIRECTIONS.find(d => d.v === v) ?? { l: v, cls: 'bg-slate-100 text-slate-600' }
const priCfg = (v: string) => PRIORITIES.find(p => p.v === v) ?? { l: v, cls: 'bg-slate-100 text-slate-600' }

const EMPTY: Omit<Task, 'id'> = {
  title: '', direction: 'content', priority: 'normal', assignee: '', deadline: null, status: 'todo', result: '',
}

export default function MarketingTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [dirFilter, setDirFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('open')
  const [form, setForm] = useState<Omit<Task, 'id'>>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/marketing/tasks')
    setTasks(res.ok ? await res.json() : [])
    setLoading(false)
  }

  async function setStatus(t: Task, status: string) {
    await fetch('/api/marketing/tasks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, status }) })
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status } : x))
  }

  async function save() {
    if (!form.title.trim()) return
    setSaving(true)
    const method = editId ? 'PUT' : 'POST'
    const body = editId ? { id: editId, ...form } : form
    await fetch('/api/marketing/tasks', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    setShowForm(false)
    load()
  }

  const filtered = tasks.filter(t => {
    const dir = dirFilter === 'all' || t.direction === dirFilter
    const st  = statusFilter === 'all' || (statusFilter === 'open' ? t.status === 'todo' || t.status === 'in_progress' : t.status === statusFilter)
    return dir && st
  })

  const openCount = tasks.filter(t => t.status === 'todo' || t.status === 'in_progress').length
  const doneCount = tasks.filter(t => t.status === 'done').length

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-muted">Загрузка...</div>

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">

      <PageHeader
        title="Задачи маркетинга"
        subtitle={`${openCount} открытых · ${doneCount} выполнено`}
        actions={
          <button onClick={() => { setForm(EMPTY); setEditId(null); setShowForm(true) }}
            className="flex-shrink-0 px-4 py-2 bg-ink text-white rounded-xl text-[13px] font-medium hover:bg-[#2a2a28] transition-colors">
            + Задача
          </button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        <SelectField value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="open">Открытые</option>
          <option value="all">Все</option>
          {STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
        </SelectField>
        <SelectField value={dirFilter} onChange={e => setDirFilter(e.target.value)}>
          <option value="all">Все направления</option>
          {DIRECTIONS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
        </SelectField>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && <EmptyState title="Нет задач" hint="Добавьте первую." />}
        {filtered.map(t => {
          const done = t.status === 'done' || t.status === 'cancelled'
          const isOverdue = t.deadline && new Date(t.deadline) < new Date() && !done
          return (
            <div key={t.id} className={`bg-surface border rounded-xl p-3 flex items-center gap-3 ${done ? 'opacity-50 border-line-soft' : isOverdue ? 'border-red-200' : 'border-line'}`}>
              <button onClick={() => setStatus(t, done ? 'todo' : 'done')}
                className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-faint hover:border-emerald-400'}`}>
                {done && '✓'}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-medium ${done ? 'line-through text-muted' : 'text-ink'}`}>{t.title}</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded ${dirCfg(t.direction).cls}`}>{dirCfg(t.direction).l}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded ${priCfg(t.priority).cls}`}>{priCfg(t.priority).l}</span>
                  {t.assignee && <span className="text-[11px] text-muted">@{t.assignee}</span>}
                  {t.deadline && <span className={`text-[11px] ${isOverdue ? 'text-red-500 font-medium' : 'text-muted'}`}>{t.deadline}</span>}
                </div>
                {t.result && done && <p className="text-[12px] text-emerald-700 mt-1">✓ {t.result}</p>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {!done && (
                  <button onClick={() => setStatus(t, t.status === 'in_progress' ? 'todo' : 'in_progress')}
                    className="text-[11px] px-2.5 py-1 rounded-lg border border-line text-ink-soft hover:bg-subtle transition-colors">
                    {t.status === 'in_progress' ? 'Пауза' : 'В работу'}
                  </button>
                )}
                <button onClick={() => { const { id, ...rest } = t; setForm(rest); setEditId(id); setShowForm(true) }}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-line text-ink-soft hover:bg-subtle transition-colors">Ред.</button>
                <button onClick={async () => { if (!confirm('Удалить?')) return; await fetch('/api/marketing/tasks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id }) }); setTasks(prev => prev.filter(x => x.id !== t.id)) }}
                  className="text-[11px] px-2 py-1 text-red-400 hover:text-red-600 transition-colors">✕</button>
              </div>
            </div>
          )
        })}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-[16px] font-semibold text-ink mb-5">{editId ? 'Редактировать задачу' : 'Новая задача'}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-ink-soft mb-1">Задача *</label>
                <Field type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Снять 5 видео с производства"
                  className="w-full" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Направление</label>
                  <SelectField value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))} className="w-full">
                    {DIRECTIONS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                  </SelectField>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Приоритет</label>
                  <SelectField value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="w-full">
                    {PRIORITIES.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
                  </SelectField>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Ответственный</label>
                  <Field type="text" value={form.assignee ?? ''} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))}
                    placeholder="Иван"
                    className="w-full" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Дедлайн</label>
                  <input type="date" value={form.deadline ?? ''} onChange={e => setForm(f => ({ ...f, deadline: e.target.value || null }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[12px]" />
                </div>
              </div>
              {editId && (
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Статус</label>
                  <SelectField value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full">
                    {STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                  </SelectField>
                </div>
              )}
              {(form.status === 'done') && (
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Результат</label>
                  <Field type="text" value={form.result ?? ''} onChange={e => setForm(f => ({ ...f, result: e.target.value }))}
                    placeholder="Что было сделано / достигнуто"
                    className="w-full" />
                </div>
              )}
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={save} disabled={saving}
                className="px-5 py-2 bg-ink text-white rounded-xl text-[13px] font-medium disabled:opacity-50 transition-colors">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={() => setShowForm(false)}
                className="px-5 py-2 border border-line rounded-xl text-[13px] text-ink-soft hover:bg-canvas transition-colors">Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
