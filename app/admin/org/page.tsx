'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ROLES_DATA, LEVEL_LABELS, type RoleData } from '@/lib/roles-data'

type Assignment = {
  id: string
  role_id: string
  first_name: string
  last_name: string | null
  phone: string | null
  telegram: string | null
  email: string | null
  notes: string | null
  active: boolean
}

type TabKey = 'people' | 'functions' | 'regulations'

const LEVEL_COLORS: Record<number, string> = {
  0: 'bg-purple-100 text-purple-700 border-purple-200',
  1: 'bg-blue-100 text-blue-700 border-blue-200',
  2: 'bg-slate-100 text-slate-600 border-slate-200',
}

export default function OrgPage() {
  const [tab, setTab] = useState<TabKey>('people')
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editAssignment, setEditAssignment] = useState<Assignment | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    role_id: '',
    first_name: '',
    last_name: '',
    phone: '',
    telegram: '',
    email: '',
    notes: '',
  })

  useEffect(() => {
    fetch('/api/admin/role-assignments')
      .then(r => r.json())
      .then(d => { setAssignments(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function openAdd() {
    setForm({ role_id: '', first_name: '', last_name: '', phone: '', telegram: '', email: '', notes: '' })
    setEditAssignment(null)
    setShowAddModal(true)
  }

  function openEdit(a: Assignment) {
    setForm({
      role_id: a.role_id,
      first_name: a.first_name,
      last_name: a.last_name ?? '',
      phone: a.phone ?? '',
      telegram: a.telegram ?? '',
      email: a.email ?? '',
      notes: a.notes ?? '',
    })
    setEditAssignment(a)
    setShowAddModal(true)
  }

  async function saveForm() {
    if (!form.role_id || !form.first_name.trim()) return
    setSaving(true)
    try {
      if (editAssignment) {
        const res = await fetch(`/api/admin/role-assignments/${editAssignment.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        const updated = await res.json()
        setAssignments(prev => prev.map(a => a.id === editAssignment.id ? { ...a, ...updated } : a))
      } else {
        const res = await fetch('/api/admin/role-assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        const created = await res.json()
        setAssignments(prev => [...prev, created])
      }
      setShowAddModal(false)
    } finally {
      setSaving(false)
    }
  }

  async function removeAssignment(id: string) {
    if (!confirm('Удалить назначение?')) return
    await fetch(`/api/admin/role-assignments/${id}`, { method: 'DELETE' })
    setAssignments(prev => prev.filter(a => a.id !== id))
  }

  const assignmentsByRole = assignments.reduce<Record<string, Assignment[]>>((acc, a) => {
    if (!acc[a.role_id]) acc[a.role_id] = []
    acc[a.role_id].push(a)
    return acc
  }, {})

  const grouped = [0, 1, 2].map(level => ({
    level,
    label: LEVEL_LABELS[level],
    roles: ROLES_DATA.filter(r => r.level === level).sort((a, b) => a.sort_order - b.sort_order),
  }))

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Оргструктура</h1>
          <p className="text-sm text-muted mt-0.5">Роли, сотрудники и функциональные регламенты MGlass</p>
        </div>
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-[#111110] text-white text-sm font-semibold rounded-lg hover:bg-[#2a2a28] transition-colors"
        >
          + Добавить сотрудника
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-canvas p-1 rounded-xl w-fit">
        {([
          { key: 'people', label: '👤 Сотрудники' },
          { key: 'functions', label: '✅ Функции' },
          { key: 'regulations', label: '📋 Регламенты' },
        ] as { key: TabKey; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: PEOPLE ── */}
      {tab === 'people' && (
        <div className="space-y-8">
          {loading ? (
            <p className="text-sm text-muted">Загрузка...</p>
          ) : (
            grouped.map(({ level, label, roles }) => (
              <div key={level}>
                <div className="flex items-center gap-3 mb-3">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${LEVEL_COLORS[level]}`}>
                    {label}
                  </span>
                  <div className="flex-1 h-px bg-line" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {roles.map(role => {
                    const people = assignmentsByRole[role.id] ?? []
                    return (
                      <div key={role.id} className="border border-line rounded-xl p-4 bg-surface hover:border-faint transition-colors">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{role.emoji}</span>
                            <div>
                              <p className="text-sm font-semibold text-ink leading-tight">{role.title}</p>
                              <Link
                                href={`/admin/org/${role.id}`}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Регламент →
                              </Link>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-1.5 mt-3">
                          {people.length === 0 ? (
                            <p className="text-xs text-faint italic">Вакантно</p>
                          ) : (
                            people.map(p => (
                              <div key={p.id} className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <div className="w-5 h-5 rounded-full bg-line-soft flex items-center justify-center flex-shrink-0">
                                    <span className="text-[11px] font-semibold text-ink-soft">
                                      {p.first_name[0]}{p.last_name?.[0] ?? ''}
                                    </span>
                                  </div>
                                  <span className="text-xs text-ink-soft truncate">
                                    {p.first_name} {p.last_name ?? ''}
                                  </span>
                                </div>
                                <div className="flex gap-1 flex-shrink-0">
                                  <button
                                    onClick={() => openEdit(p)}
                                    className="text-[11px] px-1.5 py-0.5 rounded bg-canvas text-ink-soft hover:bg-line transition-colors"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    onClick={() => removeAssignment(p.id)}
                                    className="text-[11px] px-1.5 py-0.5 rounded bg-canvas text-red-400 hover:bg-red-50 transition-colors"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── TAB: FUNCTIONS ── */}
      {tab === 'functions' && (
        <div className="space-y-6">
          {grouped.map(({ level, label, roles }) => (
            <div key={level}>
              <div className="flex items-center gap-3 mb-3">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${LEVEL_COLORS[level]}`}>
                  {label}
                </span>
                <div className="flex-1 h-px bg-line" />
              </div>
              <div className="space-y-3">
                {roles.map(role => (
                  <div key={role.id} className="border border-line rounded-xl p-4 bg-surface">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-base">{role.emoji}</span>
                      <p className="text-sm font-semibold text-ink">{role.title}</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                      {role.functions.map(fn => (
                        <div key={fn.id} className="flex items-start gap-2">
                          <div className="w-4 h-4 rounded border border-line bg-canvas flex-shrink-0 mt-0.5" />
                          <span className="text-xs text-ink-soft leading-snug">{fn.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── TAB: REGULATIONS ── */}
      {tab === 'regulations' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ROLES_DATA.map(role => (
            <Link
              key={role.id}
              href={`/admin/org/${role.id}`}
              className="border border-line rounded-xl p-4 bg-surface hover:border-faint hover:shadow-sm transition-all group"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{role.emoji}</span>
                <div>
                  <p className="text-sm font-semibold text-ink group-hover:text-blue-600 transition-colors">
                    {role.title}
                  </p>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${LEVEL_COLORS[role.level]}`}>
                    {LEVEL_LABELS[role.level]}
                  </span>
                </div>
              </div>
              <p className="text-xs text-ink-soft leading-snug line-clamp-2">{role.mainGoal}</p>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] text-muted">{role.functions.length} функций</span>
                <span className="text-[11px] text-blue-600 group-hover:underline">Открыть →</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* ── MODAL ── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-base font-semibold text-ink mb-4">
              {editAssignment ? 'Редактировать сотрудника' : 'Добавить сотрудника'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-ink-soft mb-1 block">Роль *</label>
                <select
                  value={form.role_id}
                  onChange={e => setForm(f => ({ ...f, role_id: e.target.value }))}
                  disabled={!!editAssignment}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm text-ink bg-surface disabled:opacity-60"
                >
                  <option value="">Выберите роль</option>
                  {ROLES_DATA.map(r => (
                    <option key={r.id} value={r.id}>{r.emoji} {r.title}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-soft mb-1 block">Имя *</label>
                  <input
                    value={form.first_name}
                    onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                    placeholder="Иван"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-soft mb-1 block">Фамилия</label>
                  <input
                    value={form.last_name}
                    onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                    placeholder="Иванов"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-soft mb-1 block">Телефон</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+7 900 000 00 00"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-soft mb-1 block">Telegram</label>
                  <input
                    value={form.telegram}
                    onChange={e => setForm(f => ({ ...f, telegram: e.target.value }))}
                    placeholder="@username"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-soft mb-1 block">Email</label>
                <input
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="ivan@example.com"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-soft mb-1 block">Заметки</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  placeholder="Дополнительная информация..."
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 border border-line rounded-lg text-sm text-ink-soft hover:bg-canvas"
              >
                Отмена
              </button>
              <button
                onClick={saveForm}
                disabled={saving || !form.role_id || !form.first_name.trim()}
                className="flex-1 px-4 py-2 bg-[#111110] text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-[#2a2a28]"
              >
                {saving ? 'Сохраняем...' : editAssignment ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
