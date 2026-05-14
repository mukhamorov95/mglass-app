'use client'

import { useEffect, useState } from 'react'

type User = {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'manager'
  active: boolean
  manager_code: number | null
  password_plain: string | null
  see_all_orders: boolean
  created_at: string
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin:   { label: 'Администратор', color: 'bg-purple-50 text-purple-700' },
  manager: { label: 'Менеджер',      color: 'bg-blue-50 text-blue-700' },
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteRole, setInviteRole] = useState<'manager' | 'admin'>('manager')
  const [inviteName, setInviteName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set())
  const [editingPassword, setEditingPassword] = useState<string | null>(null)
  const [editPasswordValue, setEditPasswordValue] = useState('')
  const [telegramCode, setTelegramCode] = useState<{ userId: string; code: string } | null>(null)

  useEffect(() => { fetchUsers() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowInvite(false); setError(null) } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  async function fetchUsers() {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    const data = await res.json()
    setUsers(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  async function updateUser(id: string, fields: Partial<User>) {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...fields } : u))
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    })
    if (!res.ok) await fetchUsers()
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, password: invitePassword, role: inviteRole, name: inviteName }),
    })
    const json = await res.json()
    setSaving(false)

    if (!res.ok) { setError(json.error ?? 'Ошибка'); return }
    setShowInvite(false)
    setInviteEmail('')
    setInvitePassword('')
    setInviteName('')
    setInviteRole('manager')
    fetchUsers()
  }

  function togglePassword(id: string) {
    setVisiblePasswords(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function startEditPassword(u: User) {
    setEditingPassword(u.id)
    setEditPasswordValue(u.password_plain ?? '')
  }

  async function savePassword(id: string) {
    const val = editPasswordValue.trim()
    setEditingPassword(null)
    if (!val) return
    await updateUser(id, { password_plain: val })
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Пользователи</h1>
          <button onClick={() => setShowInvite(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            + Добавить
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Загрузка...</div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">Нет пользователей</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Имя / Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Пароль</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Роль</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase" title="Номер менеджера в номере заказа">Код №</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase" title="Видит все заказы или только свои">Заказы</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => {
                  const rl = ROLE_LABELS[u.role] ?? ROLE_LABELS.manager
                  const pwVisible = visiblePasswords.has(u.id)
                  return (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{u.name ?? '—'}</p>
                        <p className="text-xs text-gray-400">{u.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        {editingPassword === u.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={editPasswordValue}
                            onChange={e => setEditPasswordValue(e.target.value)}
                            onBlur={() => savePassword(u.id)}
                            onKeyDown={e => { if (e.key === 'Enter') savePassword(u.id); if (e.key === 'Escape') setEditingPassword(null) }}
                            className="font-mono text-sm border border-blue-300 rounded px-2 py-0.5 w-36 outline-none"
                            placeholder="новый пароль"
                          />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span
                              onClick={() => startEditPassword(u)}
                              className="font-mono text-sm text-gray-700 cursor-pointer hover:text-blue-600"
                              title="Нажми чтобы изменить"
                            >
                              {u.password_plain
                                ? pwVisible ? u.password_plain : '••••••••'
                                : <span className="text-gray-300 text-xs italic">не задан</span>
                              }
                            </span>
                            {u.password_plain && (
                              <button onClick={() => togglePassword(u.id)} className="text-gray-400 hover:text-gray-600" title={pwVisible ? 'Скрыть' : 'Показать'}>
                                {pwVisible ? '🙈' : '👁'}
                              </button>
                            )}
                            <button onClick={() => startEditPassword(u)} className="text-gray-300 hover:text-blue-400 text-xs" title="Изменить пароль">✏️</button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select value={u.role}
                          onChange={e => updateUser(u.id, { role: e.target.value as User['role'] })}
                          className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${rl.color}`}>
                          <option value="manager">Менеджер</option>
                          <option value="admin">Администратор</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="number" min="1" max="99"
                          value={u.manager_code ?? 1}
                          onChange={e => updateUser(u.id, { manager_code: Number(e.target.value) || 1 })}
                          className="w-14 text-center border border-gray-200 rounded-lg px-2 py-1 text-sm font-mono outline-none focus:border-blue-400"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {u.role === 'manager' ? (
                          <button
                            onClick={() => updateUser(u.id, { see_all_orders: !(u.see_all_orders ?? false) })}
                            className={`text-xs px-3 py-1 rounded-full font-medium ${(u.see_all_orders ?? false) ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}
                            title={(u.see_all_orders ?? false) ? 'Видит все заказы — нажать чтобы ограничить' : 'Видит только свои — нажать чтобы открыть все'}
                          >
                            {(u.see_all_orders ?? false) ? 'Все' : 'Свои'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => updateUser(u.id, { active: !u.active })}
                            className={`text-xs px-3 py-1 rounded-full font-medium ${u.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {u.active ? 'Активен' : 'Отключён'}
                          </button>
                          <button
                            onClick={async () => {
                              const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'telegram_code', userId: u.id }) })
                              const data = await res.json()
                              if (data.code) setTelegramCode({ userId: u.id, code: data.code })
                            }}
                            className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100"
                            title="Создать Telegram-код"
                          >
                            TG
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {telegramCode && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setTelegramCode(null)}>
            <div className="bg-white rounded-xl p-6 w-full max-w-xs shadow-xl text-center" onClick={e => e.stopPropagation()}>
              <p className="text-sm text-gray-500 mb-2">Telegram-код (15 минут)</p>
              <p className="text-4xl font-mono font-bold text-gray-900 tracking-widest mb-4">{telegramCode.code}</p>
              <p className="text-xs text-gray-400 mb-4">Отправь этот код боту MGlass в Telegram</p>
              <button onClick={() => setTelegramCode(null)} className="w-full bg-gray-100 text-gray-700 text-sm font-medium rounded-lg py-2">Закрыть</button>
            </div>
          </div>
        )}

        {showInvite && (
          <div
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto"
            onClick={e => { if (e.target === e.currentTarget) { setShowInvite(false); setError(null) } }}
          >
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm shadow-xl">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Новый пользователь</h2>
              <form onSubmit={handleInvite} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Имя</label>
                  <input value={inviteName} onChange={e => setInviteName(e.target.value)}
                    placeholder="Иван Иванов"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                    placeholder="manager@mglass.ru"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Пароль</label>
                  <input type="text" required minLength={6} value={invitePassword} onChange={e => setInvitePassword(e.target.value)}
                    placeholder="Минимум 6 символов"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-gray-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Роль</label>
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'manager' | 'admin')}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400">
                    <option value="manager">Менеджер</option>
                    <option value="admin">Администратор</option>
                  </select>
                </div>
                {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={saving}
                    className="flex-1 bg-blue-600 text-white text-sm font-medium rounded-lg py-2 hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Создание...' : 'Создать'}
                  </button>
                  <button type="button" onClick={() => { setShowInvite(false); setError(null) }}
                    className="flex-1 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg py-2 hover:bg-gray-200">
                    Отмена
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
