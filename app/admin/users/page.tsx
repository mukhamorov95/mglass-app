'use client'

import { useEffect, useState } from 'react'
import type { UserPermissions } from '@/lib/permissions'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions'

type User = {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'manager' | 'buyer' | 'ceo' | 'commercial' | 'production' | 'seo'
  active: boolean
  manager_code: number | null
  password_plain: string | null
  see_all_orders: boolean
  can_view_all_clients: boolean
  can_view_all_deals: boolean
  amo_user_id: number | null
  max_discount_percent: number | null
  can_delete: boolean
  permissions: UserPermissions
  production_station: string | null
  created_at: string
}

// Станции цеха — словарь совпадает с lib/productionStages.ts DetailStageKey (без 'problem').
const STATIONS: { value: string; label: string }[] = [
  { value: 'cutting',   label: 'Резка' },
  { value: 'polishing', label: 'Полировка' },
  { value: 'drilling',  label: 'Сверловка' },
  { value: 'tempering', label: 'Закалка' },
  { value: 'packaging', label: 'Упаковка' },
]

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin:      { label: 'Администратор', color: 'bg-purple-50 text-purple-700' },
  manager:    { label: 'Менеджер',      color: 'bg-blue-50 text-blue-700' },
  buyer:      { label: 'Закупщик',      color: 'bg-emerald-50 text-emerald-700' },
  ceo:        { label: 'CEO',           color: 'bg-amber-50 text-amber-700' },
  commercial: { label: 'Коммерческий',  color: 'bg-indigo-50 text-indigo-700' },
  production: { label: 'Производство',  color: 'bg-orange-50 text-orange-700' },
  seo:        { label: 'SEO',           color: 'bg-rose-50 text-rose-700' },
}

const PERM_LABELS: { key: keyof UserPermissions; icon: string; label: string }[] = [
  { key: 'see_mglass',   icon: '🪞', label: 'MGlass' },
  { key: 'see_b2b',      icon: '📦', label: 'B2B' },
  { key: 'see_calendar', icon: '📅', label: 'Календарь' },
  { key: 'see_clients',  icon: '👤', label: 'Клиенты' },
  { key: 'see_earnings', icon: '💰', label: 'Заработки' },
]

function fmtCode(code: number | null): string {
  if (code === null) return '—'
  return String(code).padStart(2, '0')
}

function resolvePerms(raw: unknown): UserPermissions {
  if (raw && typeof raw === 'object') {
    return { ...DEFAULT_PERMISSIONS, ...(raw as Partial<UserPermissions>) }
  }
  return { ...DEFAULT_PERMISSIONS }
}

export default function UsersPage() {
  const [users, setUsers]               = useState<User[]>([])
  const [loading, setLoading]           = useState(true)
  const [showInvite, setShowInvite]     = useState(false)
  const [inviteEmail, setInviteEmail]   = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteRole, setInviteRole]     = useState<'manager' | 'admin' | 'buyer'>('manager')
  const [inviteName, setInviteName]     = useState('')
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set())
  const [editingPassword, setEditingPassword]   = useState<string | null>(null)
  const [editPasswordValue, setEditPasswordValue] = useState('')
  const [telegramCode, setTelegramCode] = useState<{ userId: string; code: string } | null>(null)
  const [expandedPerms, setExpandedPerms] = useState<Set<string>>(new Set())

  useEffect(() => { fetchUsers() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowInvite(false); setError(null) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  async function fetchUsers() {
    setLoading(true)
    const res  = await fetch('/api/admin/users')
    const data = await res.json()
    const rows = (Array.isArray(data) ? data : []).map((u: User) => ({
      ...u,
      permissions: resolvePerms(u.permissions),
    }))
    setUsers(rows)
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

  async function togglePerm(u: User, key: keyof UserPermissions) {
    const updated = { ...resolvePerms(u.permissions), [key]: !u.permissions[key] }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, permissions: updated } : x))
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, permissions: updated }),
    })
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
    setInviteEmail(''); setInvitePassword(''); setInviteName(''); setInviteRole('manager')
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

  function toggleExpandPerms(id: string) {
    setExpandedPerms(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7] p-6">
      <div className="max-w-5xl mx-auto">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[18px] font-semibold text-[#111110]">Пользователи</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">Роли, доступ и права в системе MGlass</p>
          </div>
          <button onClick={() => setShowInvite(true)}
            className="px-4 py-2 bg-[#111110] text-white text-[13px] font-medium rounded-lg hover:bg-[#2a2a28]">
            + Добавить
          </button>
        </div>

        {/* Легенда */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 mb-4 text-[11px] text-[#6b6b66] flex flex-wrap gap-x-6 gap-y-1">
          <span><span className="font-semibold text-[#111110]">Код</span> — суффикс в номере заказа (00→1795-00, 02→1796-02)</span>
          <span><span className="font-semibold text-[#111110]">Скидка</span> — максимальный % который менеджер может дать клиенту</span>
          <span><span className="font-semibold text-[#111110]">Удаление</span> — право удалять заказы и расчёты</span>
          <span><span className="font-semibold text-[#111110]">Заказы</span> — все или только свои</span>
          <span><span className="font-semibold text-[#111110]">Клиенты</span> — все или только свои</span>
          <span><span className="font-semibold text-[#111110]">Доступ</span> — разделы меню которые видит менеджер</span>
        </div>

        {/* Warning: managers with no discount limit set */}
        {(() => {
          const noLimit = users.filter(u => u.role !== 'admin' && u.max_discount_percent === null)
          if (!noLimit.length) return null
          return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-[12px] text-amber-800 flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0">⚠️</span>
              <span>
                <span className="font-semibold">{noLimit.length} {noLimit.length === 1 ? 'менеджер' : 'менеджера/менеджеров'}</span> без лимита скидки: {noLimit.map(u => u.name ?? u.email).join(', ')}.
                Без явного лимита используется fallback 5% — установите значение вручную.
              </span>
            </div>
          )
        })()}

        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-[13px] text-[#9a9a95]">Загрузка...</div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-[#9a9a95]">Нет пользователей</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="bg-[#fafaf9] border-b border-[#e4e4e0]">
                <tr>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Сотрудник</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Пароль</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Роль</th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest" title="Код в номере заказа">Код</th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest" title="Максимальная скидка %">Скидка</th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest" title="Право удалять">Удаление</th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest" title="Видит все заказы или только свои">Заказы</th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest" title="Видит всех клиентов или только своих">Клиенты</th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest" title="AmoCRM User ID для раздела Менеджер">AMO ID</th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Статус</th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Доступ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f8f8f7]">
                {users.map(u => {
                  const rl      = ROLE_LABELS[u.role] ?? ROLE_LABELS.manager
                  const pwVisible = visiblePasswords.has(u.id)
                  const isAdmin = u.role === 'admin'
                  const isBuyer = u.role === 'buyer'
                  const permsExpanded = expandedPerms.has(u.id)
                  const perms   = resolvePerms(u.permissions)

                  return (
                    <>
                      <tr key={u.id} className="hover:bg-[#fafaf9]">

                        {/* Сотрудник */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-[#f0f0ec] flex items-center justify-center text-[11px] font-bold text-[#6b6b66] flex-shrink-0">
                              {fmtCode(u.manager_code)}
                            </div>
                            <div>
                              <p className="font-semibold text-[#111110]">{u.name ?? '—'}</p>
                              <p className="text-[11px] text-[#9a9a95]">{u.email}</p>
                            </div>
                          </div>
                        </td>

                        {/* Пароль */}
                        <td className="px-4 py-3">
                          {editingPassword === u.id ? (
                            <input
                              autoFocus type="text"
                              value={editPasswordValue}
                              onChange={e => setEditPasswordValue(e.target.value)}
                              onBlur={() => savePassword(u.id)}
                              onKeyDown={e => { if (e.key === 'Enter') savePassword(u.id); if (e.key === 'Escape') setEditingPassword(null) }}
                              className="font-mono text-[12px] border border-blue-300 rounded px-2 py-0.5 w-36 outline-none"
                              placeholder="новый пароль"
                            />
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span
                                onClick={() => startEditPassword(u)}
                                className="font-mono text-[12px] text-[#6b6b66] cursor-pointer hover:text-blue-600"
                                title="Нажми чтобы изменить">
                                {u.password_plain
                                  ? pwVisible ? u.password_plain : '••••••••'
                                  : <span className="text-[#c4c4be] text-[11px] italic">не задан</span>}
                              </span>
                              {u.password_plain && (
                                <button onClick={() => togglePassword(u.id)} className="text-[#c4c4be] hover:text-[#6b6b66]">
                                  {pwVisible ? '🙈' : '👁'}
                                </button>
                              )}
                              <button onClick={() => startEditPassword(u)} className="text-[#d4d4ce] hover:text-blue-400 text-[11px]">✏️</button>
                            </div>
                          )}
                        </td>

                        {/* Роль */}
                        <td className="px-4 py-3">
                          <select value={u.role}
                            onChange={e => updateUser(u.id, { role: e.target.value as User['role'] })}
                            className={`text-[11px] font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${rl.color}`}>
                            <option value="manager">Менеджер</option>
                            <option value="buyer">Закупщик</option>
                            <option value="ceo">CEO</option>
                            <option value="commercial">Коммерческий</option>
                            <option value="production">Производство</option>
                            <option value="seo">SEO</option>
                            <option value="admin">Администратор</option>
                          </select>
                          {u.role === 'production' && (
                            <select value={u.production_station ?? ''}
                              onChange={e => updateUser(u.id, { production_station: e.target.value || null })}
                              title="Станция цеха — какие задачи видит рабочий в «Мои задачи»"
                              className="block mt-1.5 text-[11px] px-2 py-1 rounded-lg border border-[#e4e4e0] cursor-pointer text-[#6b6b66] outline-none focus:border-[#111110]">
                              <option value="">— станция —</option>
                              {STATIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                          )}
                        </td>

                        {/* Код менеджера */}
                        <td className="px-3 py-3 text-center">
                          <input
                            type="number" min="0" max="99"
                            value={u.manager_code ?? 0}
                            onChange={e => updateUser(u.id, { manager_code: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })}
                            className="w-14 text-center border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono outline-none focus:border-[#111110]"
                            title={`Формат: ${fmtCode(u.manager_code)}`}
                          />
                        </td>

                        {/* Максимальная скидка */}
                        <td className="px-3 py-3 text-center">
                          {isAdmin ? (
                            <span className="text-[11px] text-[#9a9a95] font-mono">∞</span>
                          ) : u.max_discount_percent === null ? (
                            <button
                              onClick={() => updateUser(u.id, { max_discount_percent: 10 })}
                              className="text-[11px] px-2.5 py-1 rounded-full font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                              title="Нажми чтобы задать лимит 10%">
                              не задан
                            </button>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="number" min="0" max="100"
                                value={u.max_discount_percent}
                                onChange={e => updateUser(u.id, { max_discount_percent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                                className="w-14 text-center border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono outline-none focus:border-[#111110]"
                              />
                              <span className="text-[11px] text-[#9a9a95]">%</span>
                            </div>
                          )}
                        </td>

                        {/* Право удаления */}
                        <td className="px-3 py-3 text-center">
                          {isAdmin ? (
                            <span className="text-[11px] font-semibold text-emerald-600">✓</span>
                          ) : (
                            <button
                              onClick={() => updateUser(u.id, { can_delete: !u.can_delete })}
                              className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${u.can_delete ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-[#f0f0ec] text-[#9a9a95] hover:bg-[#e8e8e4]'}`}>
                              {u.can_delete ? '✓ да' : '✕ нет'}
                            </button>
                          )}
                        </td>

                        {/* Видимость заказов */}
                        <td className="px-3 py-3 text-center">
                          {isAdmin ? (
                            <span className="text-[11px] font-semibold text-emerald-600">Все</span>
                          ) : (
                            <button
                              onClick={() => updateUser(u.id, { see_all_orders: !u.see_all_orders })}
                              className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${u.see_all_orders ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-[#f0f0ec] text-[#9a9a95] hover:bg-[#e8e8e4]'}`}>
                              {u.see_all_orders ? 'Все' : 'Свои'}
                            </button>
                          )}
                        </td>

                        {/* Видимость клиентов */}
                        <td className="px-3 py-3 text-center">
                          {isAdmin ? (
                            <span className="text-[11px] font-semibold text-emerald-600">Все</span>
                          ) : (
                            <button
                              onClick={() => updateUser(u.id, { can_view_all_clients: !u.can_view_all_clients })}
                              className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${u.can_view_all_clients ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-[#f0f0ec] text-[#9a9a95] hover:bg-[#e8e8e4]'}`}>
                              {u.can_view_all_clients ? 'Все' : 'Свои'}
                            </button>
                          )}
                        </td>

                        {/* AmoCRM User ID */}
                        <td className="px-3 py-3 text-center">
                          <input
                            type="number" min="0"
                            value={u.amo_user_id ?? ''}
                            placeholder="ID"
                            onChange={e => updateUser(u.id, { amo_user_id: e.target.value ? Number(e.target.value) : null })}
                            className="w-24 text-center border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono outline-none focus:border-[#111110] placeholder-[#c4c4be]"
                          />
                        </td>

                        {/* Статус */}
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button onClick={() => updateUser(u.id, { active: !u.active })}
                              className={`text-[11px] px-2 py-1 rounded-full font-medium transition-colors ${u.active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-[#f0f0ec] text-[#9a9a95]'}`}>
                              {u.active ? 'Активен' : 'Откл.'}
                            </button>
                            <button
                              onClick={async () => {
                                const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'telegram_code', userId: u.id }) })
                                const data = await res.json()
                                if (data.code) setTelegramCode({ userId: u.id, code: data.code })
                              }}
                              className="text-[11px] px-2 py-1 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100"
                              title="Создать Telegram-код">
                              TG
                            </button>
                          </div>
                        </td>

                        {/* Доступ — expand button */}
                        <td className="px-3 py-3 text-center">
                          {isAdmin ? (
                            <span className="text-[10px] text-[#9a9a95]">Всё</span>
                          ) : isBuyer ? (
                            <span className="text-[10px] text-emerald-600 font-medium">Каталог</span>
                          ) : (
                            <button
                              onClick={() => toggleExpandPerms(u.id)}
                              className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-colors ${permsExpanded ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}
                              title="Настроить разделы доступа">
                              {permsExpanded ? '▲ Скрыть' : '▼ Права'}
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* Permissions expansion row */}
                      {!isAdmin && !isBuyer && permsExpanded && (
                        <tr key={`${u.id}-perms`} className="bg-[#fafaf9]">
                          <td colSpan={10} className="px-6 py-4 border-t border-[#f0f0ec]">
                            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2.5">Разделы меню</p>
                            <div className="flex flex-wrap gap-2">
                              {PERM_LABELS.map(p => {
                                const enabled = perms[p.key]
                                return (
                                  <button
                                    key={p.key}
                                    onClick={() => togglePerm(u, p.key)}
                                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                                      enabled
                                        ? 'bg-white border-emerald-300 text-emerald-700 shadow-sm hover:border-emerald-400'
                                        : 'bg-[#f5f5f3] border-[#e4e4e0] text-[#b8b8b2] hover:bg-[#efefec] hover:text-[#6b6b66]'
                                    }`}>
                                    <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0 text-[9px] font-bold ${
                                      enabled ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-[#d4d4ce] bg-white'
                                    }`}>
                                      {enabled ? '✓' : ''}
                                    </span>
                                    <span>{p.icon}</span>
                                    <span>{p.label}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Telegram code modal */}
        {telegramCode && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setTelegramCode(null)}>
            <div className="bg-white rounded-xl p-6 w-full max-w-xs shadow-xl text-center" onClick={e => e.stopPropagation()}>
              <p className="text-[13px] text-[#9a9a95] mb-2">Telegram-код (15 минут)</p>
              <p className="text-4xl font-mono font-bold text-[#111110] tracking-widest mb-4">{telegramCode.code}</p>
              <p className="text-[11px] text-[#9a9a95] mb-4">Отправь этот код боту MGlass в Telegram</p>
              <button onClick={() => setTelegramCode(null)} className="w-full bg-[#f0f0ec] text-[#6b6b66] text-[13px] font-medium rounded-lg py-2">Закрыть</button>
            </div>
          </div>
        )}

        {/* Invite modal */}
        {showInvite && (
          <div
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto"
            onClick={e => { if (e.target === e.currentTarget) { setShowInvite(false); setError(null) } }}>
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 w-full max-w-sm shadow-xl">
              <h2 className="text-[15px] font-semibold text-[#111110] mb-4">Новый пользователь</h2>
              <form onSubmit={handleInvite} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Имя</label>
                  <input value={inviteName} onChange={e => setInviteName(e.target.value)}
                    placeholder="Александра"
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Email</label>
                  <input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                    placeholder="manager@mglass.ru"
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Пароль</label>
                  <input type="text" required minLength={6} value={invitePassword} onChange={e => setInvitePassword(e.target.value)}
                    placeholder="Минимум 6 символов"
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-[#111110]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Роль</label>
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'manager' | 'admin' | 'buyer')}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]">
                    <option value="manager">Менеджер</option>
                    <option value="buyer">Закупщик</option>
                    <option value="admin">Администратор</option>
                  </select>
                </div>
                {error && <p className="text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={saving}
                    className="flex-1 bg-[#111110] text-white text-[13px] font-medium rounded-lg py-2 hover:bg-[#2a2a28] disabled:opacity-50">
                    {saving ? 'Создание...' : 'Создать'}
                  </button>
                  <button type="button" onClick={() => { setShowInvite(false); setError(null) }}
                    className="flex-1 bg-[#f0f0ec] text-[#6b6b66] text-[13px] font-medium rounded-lg py-2 hover:bg-[#e8e8e4]">
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
