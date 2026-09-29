'use client'

import { useEffect, useMemo, useState } from 'react'
import { MANAGER_AMO, MANAGER_MGLASS, MANAGER_B2B, isGroup, isSection, type NavEntry } from '@/lib/nav/managerMenu'

type Row = { user_id: string; route: string; device: string; hits: number }
type Person = { id: string; name: string; role: string; total: number; phoneShare: number; routes: { route: string; hits: number }[] }
type Resp = { from: string; to: string; rows: Row[]; people: Person[] }

const ROLE_LABEL: Record<string, string> = {
  admin: 'Админ', ceo: 'CEO', cfo: 'CFO', manager: 'Менеджеры', buyer: 'Закупщик',
  production: 'Цех', partner: 'Партнёры', seo: 'SEO', commercial: 'Коммерч.', measurer: 'Замерщик', accountant: 'Бухгалтер',
}

// Подписи из меню менеджера — чтобы владелец читал «B2B Просчёты», а не адрес.
const EXTRA_LABELS: Record<string, string> = {
  '/': 'Главная', '/deal/[id]': 'Карточка сделки', '/b2b-deal/[id]': 'Карточка заказа B2B',
  '/deals/board': 'Сделки', '/production-app': 'Цех', '/access-denied': 'Нет доступа', '/login': 'Вход',
  '/manager-dashboard': 'Дашборд менеджера (вне меню)',
}
function menuLabels(): Record<string, string> {
  const out: Record<string, string> = { ...EXTRA_LABELS }
  const walk = (list: NavEntry[]) => {
    for (const e of list) {
      if (isGroup(e)) continue
      if (isSection(e)) { e.items.forEach(i => { out[i.href] ??= i.label }); continue }
      out[e.href] ??= e.label
    }
  }
  walk(MANAGER_AMO); walk(MANAGER_MGLASS); walk(MANAGER_B2B)
  return out
}
const LABELS = menuLabels()

export default function PageUsage({ from, to }: { from?: string; to?: string }) {
  const [data, setData] = useState<Resp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<string>('manager')
  const labels = LABELS

  useEffect(() => {
    if (!from || !to) return
    let alive = true
    fetch(`/api/admin/page-usage?from=${from}&to=${to}`)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || `Сервер ответил ${r.status}`)
        return j as Resp
      })
      .then(j => { if (alive) { setData(j); setError(null) } })
      .catch((e: Error) => { if (alive) { setData(null); setError(e.message) } })
    return () => { alive = false }
  }, [from, to])

  const roleOf = useMemo(() => new Map((data?.people ?? []).map(p => [p.id, p.role])), [data])
  const roles = useMemo(() => [...new Set((data?.people ?? []).map(p => p.role))], [data])
  // По умолчанию — менеджеры; пока их в данных нет, пустой экран выглядел бы как «никто не заходит».
  const view = role !== 'all' && !roles.includes(role) ? 'all' : role

  const routes = useMemo(() => {
    const m = new Map<string, { hits: number; people: Set<string>; phone: number }>()
    for (const r of data?.rows ?? []) {
      if (view !== 'all' && roleOf.get(r.user_id) !== view) continue
      const g = m.get(r.route) ?? { hits: 0, people: new Set<string>(), phone: 0 }
      g.hits += r.hits; g.people.add(r.user_id); if (r.device !== 'desktop') g.phone += r.hits
      m.set(r.route, g)
    }
    return [...m.entries()].map(([route, g]) => ({ route, hits: g.hits, people: g.people.size, phone: g.hits ? Math.round(g.phone / g.hits * 100) : 0 }))
      .sort((a, b) => b.hits - a.hits)
  }, [data, view, roleOf])
  const people = (data?.people ?? []).filter(p => view === 'all' || p.role === view)
  const maxHits = Math.max(1, ...routes.map(r => r.hits))
  const label = (r: string) => labels[r] ?? r

  return (
    <div className="mt-8">
      <div className="mb-3">
        <h2 className="text-[16px] font-semibold text-[#111110]">Какие экраны открывают</h2>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Переход — открытие страницы или переход внутри приложения; фоновая подгрузка ссылок не считается. Пишется с 29.09.2026.</p>
      </div>

      <div className="flex gap-1 flex-wrap mb-3">
        {['all', ...roles].map(r => (
          <button key={r} onClick={() => setRole(r)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md border transition-colors ${view === r ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:bg-[#f5f5f3]'}`}>
            {r === 'all' ? 'Все' : (ROLE_LABEL[r] ?? r)}
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-[13px] text-[#c23a2b] bg-white border border-[#e4e4e0] rounded-xl px-4 py-6">Не удалось загрузить: {error}</p>
      ) : !data ? (
        <p className="text-[13px] text-[#9a9a95] bg-white border border-[#e4e4e0] rounded-xl text-center py-8">Загрузка…</p>
      ) : routes.length === 0 ? (
        <p className="text-[13px] text-[#9a9a95] bg-white border border-[#e4e4e0] rounded-xl text-center py-8">За этот период переходов нет. Замер идёт с 29.09.2026.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-[#9a9a95] border-b border-[#e4e4e0]">
                  <th className="text-left font-semibold px-4 py-2.5">Экран</th>
                  <th className="text-right font-semibold px-2 py-2.5">Переходов</th>
                  <th className="text-right font-semibold px-2 py-2.5">Людей</th>
                  <th className="text-right font-semibold px-4 py-2.5">С телефона</th>
                </tr>
              </thead>
              <tbody>
                {routes.map(r => (
                  <tr key={r.route} className="border-b border-[#f5f5f3] last:border-0">
                    <td className="px-4 py-2 min-w-0">
                      <div className="font-medium text-[#111110]">{label(r.route)}</div>
                      {labels[r.route] && <div className="text-[11px] text-[#9a9a95] font-mono">{r.route}</div>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 rounded-full bg-[#111110]" style={{ width: `${Math.max(2, Math.round((r.hits / maxHits) * 56))}px` }} />
                        <span className="tabular-nums w-10 text-right">{r.hits}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-[#6b6b66]">{r.people}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[#6b6b66]">{r.phone ? `${r.phone}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-[#e4e4e0] rounded-xl divide-y divide-[#f5f5f3]">
            {people.map(p => (
              <div key={p.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[13px] text-[#111110]">{p.name}</span>
                  <span className="text-[11px] text-[#9a9a95] tabular-nums">{p.total} перех.{p.phoneShare ? ` · телефон ${p.phoneShare}%` : ''}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {p.routes.slice(0, 5).map(r => (
                    <span key={r.route} className="text-[11px] px-2 py-0.5 rounded-md bg-[#f5f5f3] text-[#6b6b66]">
                      {label(r.route)} <span className="tabular-nums text-[#9a9a95]">{r.hits}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
