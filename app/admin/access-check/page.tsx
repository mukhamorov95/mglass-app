'use client'

import { useEffect, useState } from 'react'

// Диагностика прав: выбрал сотрудника → видно роль, скоуп, права и по каждому
// разделу «видит/не видит и почему». Чтобы разбор доступа не растягивался на
// несколько заходов (как было с Верой). Только владелец.

type UserLite = { id: string; name: string | null; email: string; role: string }
type RouteRow = { path: string; label: string; allowed: boolean; reason: string }
type Detail = {
  user: {
    id: string; name: string | null; email: string; role: string
    b2b_scope: string | null; permissions: Record<string, unknown> | null
    can_view_all_deals: boolean | null; can_view_all_clients: boolean | null
    see_all_orders: boolean | null; production_stations: string[] | null
  }
  routes: RouteRow[]
}

const SCOPE_LABEL: Record<string, string> = { mglass_only: 'только M GLASS', all_clients: 'все клиенты' }

export default function AccessCheckPage() {
  const [users, setUsers] = useState<UserLite[]>([])
  const [sel, setSel] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/access-check').then(r => r.json())
      .then(d => setUsers(d.users ?? []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!sel) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null); return
    }
    fetch(`/api/admin/access-check?userId=${sel}`).then(r => r.json()).then(setDetail).catch(() => setDetail(null))
  }, [sel])

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  const u = detail?.user
  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-16">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-6 pb-4">
        <div className="max-w-[820px] mx-auto">
          <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">🔎 Диагностика прав</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">Выбери сотрудника — покажу, что он видит и почему. Тот же расчёт, что реальный вход.</p>
          <select value={sel} onChange={e => setSel(e.target.value)}
            className="mt-3 w-full sm:w-[420px] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] bg-white outline-none focus:border-[#111110]">
            <option value="">— выбери сотрудника —</option>
            {users.map(x => <option key={x.id} value={x.id}>{x.name || x.email} · {x.role}</option>)}
          </select>
        </div>
      </div>

      {u && (
        <div className="max-w-[820px] mx-auto px-4 pt-4 space-y-3">
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[15px] font-semibold text-[#111110]">{u.name || u.email}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px] text-[#4b4b47]">
              <span>Роль: <b className="text-[#111110]">{u.role}</b></span>
              {u.role === 'buyer' && <span>B2B-доступ: <b className="text-[#111110]">{u.b2b_scope ? SCOPE_LABEL[u.b2b_scope] ?? u.b2b_scope : 'только каталог (без калькулятора)'}</b></span>}
              <span>Все сделки: {u.can_view_all_deals ? '✓' : '—'}</span>
              <span>Все клиенты: {u.can_view_all_clients ? '✓' : '—'}</span>
              <span>Все заказы: {u.see_all_orders ? '✓' : '—'}</span>
              {Array.isArray(u.production_stations) && u.production_stations.length > 0 && <span>Станции: {u.production_stations.join(', ')}</span>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
            <p className="px-4 pt-3 pb-2 text-[13px] font-semibold text-[#111110]">Доступ к разделам</p>
            {detail!.routes.map(r => (
              <div key={r.path} className="flex items-start justify-between gap-3 px-4 py-2.5 border-t border-[#f0f0ee]">
                <div className="min-w-0">
                  <p className="text-[13px] text-[#111110]">{r.label} <span className="text-[#9a9a95] font-mono text-[11px]">{r.path}</span></p>
                  <p className="text-[12px] text-[#9a9a95]">{r.reason}</p>
                </div>
                <span className={`text-[12px] font-semibold px-2.5 py-0.5 rounded-full flex-shrink-0 ${r.allowed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-50 text-red-600'}`}>
                  {r.allowed ? 'видит' : 'не видит'}
                </span>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-[#9a9a95] text-center">
            Если доступ не тот, что нужно — меняй роль или права в <a href="/admin/users" className="text-blue-600">Пользователях</a>,
            затем сотрудник обновляет страницу (F5).
          </p>
        </div>
      )}
    </div>
  )
}
