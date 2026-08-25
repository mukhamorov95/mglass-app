'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import { finalTotalOf } from '@/lib/b2b/priceOverride'

// Архив расчётов B2B — полная история просчётов, сделанных людьми (created_by задан;
// импорт из таблицы сюда не попадает). Группировка по месяцам (новые сверху, текущий
// раскрыт), фильтры (период / кто считал / клиент), удаление админом (по одному,
// массово, целым месяцем — мягко, в Корзину с возможностью восстановить).

type Row = {
  id: number
  client_name: string
  custom_number: string | null
  client_order_number: string | null
  discount_percent: number | null
  total_after_discount: number | null
  total_sale_inc_vat: number | null
  created_at: string
  archived_at: string | null
  notes: string | null
  created_by: string | null
  created_by_name: string | null
}

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const fmt = (n: number) => Math.round(n ?? 0).toLocaleString('ru-RU') + ' ₽'
const fmtDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(n); return typeof p === 'object' && p ? p : {} } catch { return {} }
}
const authorOf = (r: Row) => r.created_by_name || (parseNotes(r.notes).manager_name as string | undefined) || '—'
const priceOf = (r: Row) => finalTotalOf(r)
const statusOf = (r: Row) => (parseNotes(r.notes).status as string | undefined) || 'quote'
const STATUS_LABEL: Record<string, string> = { quote: 'Черновик', pending_approval: 'На согласовании', agreed: 'Согласован', rejected: 'Отказ', sent: 'В работе', confirmed: 'Запущен' }
const STATUS_STYLE: Record<string, string> = {
  quote: 'bg-[#f0f0ec] text-[#6b6b66]', pending_approval: 'bg-amber-50 text-amber-700',
  agreed: 'bg-emerald-50 text-emerald-700', sent: 'bg-blue-50 text-blue-700',
  confirmed: 'bg-emerald-100 text-emerald-800', rejected: 'bg-red-50 text-red-700',
}

const ic = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const IcChevron   = ({ className = '' }: { className?: string }) => <svg {...ic} className={className}><path d="m9 18 6-6-6-6" /></svg>
const IcArrowLeft = ({ className = '' }: { className?: string }) => <svg {...ic} className={className}><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
const IcDownload  = ({ className = '' }: { className?: string }) => <svg {...ic} className={className}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
const IcX         = ({ className = '' }: { className?: string }) => <svg {...ic} className={className}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
const IcArchive   = ({ className = '' }: { className?: string }) => <svg {...ic} className={className}><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>

export default function ArchivePage() {
  const [rows, setRows]       = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [role, setRole]       = useState<string | null>(null)
  const [view, setView]       = useState<'active' | 'trash'>('active')
  const [toast, setToast]     = useState<string | null>(null)

  const [search, setSearch]       = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [authorFilter, setAuthorFilter] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [busy, setBusy]       = useState(false)
  const initRef = useRef(false)

  const isAdmin = role === 'admin' || role === 'ceo'
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    (async () => {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (user) {
        const { data: prof } = await sb.from('users').select('role').eq('id', user.id).single()
        setRole((prof?.role as string) ?? null)
      }
      const cols = 'id,client_name,custom_number,client_order_number,discount_percent,total_after_discount,total_sale_inc_vat,created_at,archived_at,notes,created_by,created_by_name'
      const acc: Row[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('b2b_orders').select(cols)
          .not('created_by', 'is', null)               // просчёты людей; импорт (created_by null) не берём
          .order('created_at', { ascending: false }).range(from, from + 999)
        if (error || !data?.length) break
        acc.push(...(data as Row[]))
        if (data.length < 1000) break
      }
      setRows(acc)
      setLoading(false)
    })()
  }, [])

  // Текущий месяц раскрыт по умолчанию (один раз)
  useEffect(() => {
    if (initRef.current || rows.length === 0) return
    initRef.current = true
    const now = new Date()
    setExpandedMonths(new Set([`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`]))
  }, [rows])

  const authorOptions = useMemo(() => [...new Set(rows.map(authorOf).filter(a => a && a !== '—'))].sort(), [rows])
  const clientOptions = useMemo(() => [...new Set(rows.map(r => r.client_name).filter(Boolean))].sort(), [rows])

  const visible = useMemo(() => {
    let list = rows.filter(r => view === 'trash' ? r.archived_at : !r.archived_at)
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      list = list.filter(r => r.client_name.toLowerCase().includes(s) || (r.custom_number ?? '').toLowerCase().includes(s) || String(r.id).includes(s))
    }
    if (dateFrom) list = list.filter(r => r.created_at.slice(0, 10) >= dateFrom)
    if (dateTo)   list = list.filter(r => r.created_at.slice(0, 10) <= dateTo)
    if (authorFilter) list = list.filter(r => authorOf(r) === authorFilter)
    if (clientFilter) list = list.filter(r => r.client_name === clientFilter)
    return list
  }, [rows, view, search, dateFrom, dateTo, authorFilter, clientFilter])

  const monthGroups = useMemo(() => {
    const groups: { key: string; label: string; rows: Row[]; total: number }[] = []
    for (const r of visible) {
      const d = new Date(r.created_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      let g = groups.find(x => x.key === key)
      if (!g) { g = { key, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, rows: [], total: 0 }; groups.push(g) }
      g.rows.push(r); g.total += priceOf(r)
    }
    groups.sort((a, b) => b.key.localeCompare(a.key))
    return groups
  }, [visible])

  function toggleMonth(key: string) { setExpandedMonths(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n }) }
  function toggleSelect(id: number) { setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function toggleMonthSelect(rs: Row[]) {
    const ids = rs.map(r => r.id); const all = ids.every(id => selectedIds.has(id))
    setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => all ? n.delete(id) : n.add(id)); return n })
  }

  async function updateArchived(ids: number[], toArchived: boolean) {
    if (ids.length === 0) return
    setBusy(true)
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    const patch = toArchived
      ? { archived_at: new Date().toISOString(), updated_by_user_id: user?.id ?? null }
      : { archived_at: null }
    const { error } = await sb.from('b2b_orders').update(patch).in('id', ids)
    if (!error) {
      setRows(prev => prev.map(r => ids.includes(r.id) ? { ...r, archived_at: toArchived ? new Date().toISOString() : null } : r))
      setSelectedIds(new Set())
      showToast(toArchived ? `Удалено в корзину: ${ids.length}` : `Восстановлено: ${ids.length}`)
    } else showToast('Ошибка')
    setBusy(false)
  }
  async function purgeIds(ids: number[]) {
    if (ids.length === 0) return
    setBusy(true)
    const { error } = await createClient().from('b2b_orders').delete().in('id', ids)
    if (!error) {
      setRows(prev => prev.filter(r => !ids.includes(r.id)))
      setSelectedIds(new Set())
      showToast(`Удалено навсегда: ${ids.length}`)
    } else showToast('Ошибка')
    setBusy(false)
  }

  function deleteSelected() {
    if (!window.confirm(`Удалить в корзину ${selectedIds.size} просчёт(ов)? Их можно восстановить.`)) return
    updateArchived([...selectedIds], true)
  }
  function deleteMonth(g: { label: string; rows: Row[] }) {
    if (!window.confirm(`Удалить в корзину весь месяц «${g.label}» — ${g.rows.length} просч.? Восстановимо.`)) return
    updateArchived(g.rows.map(r => r.id), true)
  }
  function purgeSelected() {
    if (!window.confirm(`НАВСЕГДА удалить ${selectedIds.size} просчёт(ов)? Восстановить будет нельзя.`)) return
    purgeIds([...selectedIds])
  }

  const activeCount = rows.filter(r => !r.archived_at).length
  const trashCount  = rows.filter(r => r.archived_at).length

  return (
    <div className="max-w-[1100px] mx-auto px-4 py-5">
      {toast && <div className="fixed top-4 right-4 z-50 bg-[#111110] text-white text-[12px] px-4 py-2.5 rounded-xl shadow-lg">{toast}</div>}

      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-[18px] font-semibold text-[#111110]">Архив расчётов B2B</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">{visible.length} просчётов · история по месяцам</p>
        </div>
        <Link href="/b2b-quotes" className="inline-flex items-center gap-1.5 text-[12px] text-[#6b6b66] hover:text-[#111110] px-3 py-1.5 border border-[#e4e4e0] rounded-lg hover:border-[#111110] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#111110]/15"><IcArrowLeft className="w-3.5 h-3.5" />Просчёты</Link>
      </div>

      {/* Вкладки Архив / Корзина */}
      <div className="flex items-center gap-1 mb-3">
        {([['active', `Архив (${activeCount})`], ['trash', `Корзина (${trashCount})`]] as const).map(([v, label]) => (
          <button key={v} onClick={() => { setView(v); setSelectedIds(new Set()) }}
            className={`text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#111110]/15 ${view === v ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4]'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Фильтры */}
      <div className="flex items-center gap-2 mb-3 flex-wrap bg-white border border-[#e4e4e0] rounded-xl px-3 py-2.5">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: № / клиент"
          className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#111110] focus:ring-2 focus:ring-[#111110]/10 bg-white w-44" />
        <span className="text-[11px] text-[#9a9a95]">Период:</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110] focus:ring-2 focus:ring-[#111110]/10 bg-white" />
        <span className="text-[11px] text-[#9a9a95]">—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110] focus:ring-2 focus:ring-[#111110]/10 bg-white" />
        <select value={authorFilter} onChange={e => setAuthorFilter(e.target.value)} className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110] focus:ring-2 focus:ring-[#111110]/10 bg-white max-w-[170px]">
          <option value="">Кто считал: все</option>
          {authorOptions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110] focus:ring-2 focus:ring-[#111110]/10 bg-white max-w-[190px]">
          <option value="">Клиент: все</option>
          {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(search || dateFrom || dateTo || authorFilter || clientFilter) && (
          <button onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setAuthorFilter(''); setClientFilter('') }}
            className="text-[11px] text-[#6b6b66] hover:text-[#111110] px-2 py-1.5 rounded-lg border border-[#e4e4e0] hover:border-[#111110] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#111110]/15">Сбросить</button>
        )}
      </div>

      {/* Массовые действия */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-[12px] font-medium text-red-700">Выбрано: {selectedIds.size}</span>
          {view === 'active' ? (
            <button onClick={deleteSelected} disabled={busy} className="text-[12px] font-semibold text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded-lg disabled:opacity-40">Удалить выбранные</button>
          ) : (
            <>
              <button onClick={() => updateArchived([...selectedIds], false)} disabled={busy} className="text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-lg disabled:opacity-40">Восстановить</button>
              <button onClick={purgeSelected} disabled={busy} className="text-[12px] font-semibold text-white bg-red-700 hover:bg-red-800 px-3 py-1 rounded-lg disabled:opacity-40">Удалить навсегда</button>
            </>
          )}
          <button onClick={() => setSelectedIds(new Set())} className="text-[12px] text-[#6b6b66] hover:text-[#111110] ml-auto">Отмена</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-[#fafaf9] border-b border-[#f0f0ec] flex items-center gap-3">
                <div className="w-3 h-3 rounded bg-[#e6e6e2] animate-pulse" />
                <div className="h-3.5 w-32 rounded bg-[#e6e6e2] animate-pulse" />
                <div className="h-3 w-24 rounded bg-[#f0f0ec] animate-pulse" />
              </div>
              {i === 0 && (
                <div className="divide-y divide-[#f8f8f7]">
                  {[0, 1, 2, 3].map(j => (
                    <div key={j} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="h-3 w-16 rounded bg-[#f0f0ec] animate-pulse" />
                      <div className="h-3 flex-1 max-w-[220px] rounded bg-[#f0f0ec] animate-pulse" />
                      <div className="h-3 w-20 rounded bg-[#f0f0ec] animate-pulse ml-auto" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : monthGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-20">
          <IcArchive className="w-8 h-8 text-[#c4c4be] mb-3" />
          <p className="text-[13px] font-medium text-[#6b6b66]">{view === 'trash' ? 'Корзина пуста' : 'Просчётов пока нет'}</p>
          <p className="text-[12px] text-[#9a9a95] mt-1">{view === 'trash' ? 'Удалённые просчёты появятся здесь' : 'Здесь копится история просчётов B2B по месяцам'}</p>
          {view === 'active' && (
            <Link href="/b2b-quotes" className="inline-flex items-center gap-1.5 mt-4 text-[12px] text-[#6b6b66] hover:text-[#111110] px-3 py-1.5 border border-[#e4e4e0] rounded-lg hover:border-[#111110] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#111110]/15"><IcArrowLeft className="w-3.5 h-3.5" />К просчётам</Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {monthGroups.map(g => {
            const open = expandedMonths.has(g.key)
            const ids = g.rows.map(r => r.id)
            const allSel = ids.length > 0 && ids.every(id => selectedIds.has(id))
            return (
              <div key={g.key} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 flex items-center gap-3 bg-[#fafaf9] border-b border-[#f0f0ec]">
                  <button className="flex items-center gap-2 flex-1 min-w-0 text-left rounded outline-none focus-visible:ring-2 focus-visible:ring-[#111110]/15" onClick={() => toggleMonth(g.key)}>
                    <IcChevron className={`w-4 h-4 text-[#9a9a95] flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span className="text-[14px] font-bold text-[#111110]">{g.label}</span>
                    <span className="text-[11px] text-[#9a9a95]">{g.rows.length} просч. · {fmt(g.total)}</span>
                  </button>
                  {isAdmin && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => toggleMonthSelect(g.rows)} className="text-[11px] text-[#6b6b66] hover:text-[#111110] px-2 py-1 rounded-lg border border-[#e4e4e0] hover:border-[#111110] transition-colors">{allSel ? 'Снять' : 'Выбрать всё'}</button>
                      {view === 'active' && (
                        <button onClick={() => deleteMonth(g)} disabled={busy} className="text-[11px] text-red-600 hover:text-red-800 px-2 py-1 rounded-lg border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-40">Удалить месяц</button>
                      )}
                    </div>
                  )}
                </div>
                {open && (
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-[12px]">
                    <thead className="border-b border-[#f0f0ec]">
                      <tr className="text-[10px] text-[#9a9a95] uppercase tracking-wide">
                        {isAdmin && <th className="w-8" />}
                        <th className="text-left px-3 py-2">№ заказа</th>
                        <th className="text-left px-3 py-2">Клиент</th>
                        <th className="text-left px-3 py-2">Кто считал</th>
                        <th className="text-left px-3 py-2">Статус</th>
                        <th className="text-center px-3 py-2">Дата</th>
                        <th className="text-right px-3 py-2">Сумма</th>
                        <th className="w-24" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f8f8f7]">
                      {g.rows.map(r => (
                        <tr key={r.id} className={`hover:bg-[#fafaf9] ${selectedIds.has(r.id) ? 'bg-red-50/40' : ''}`}>
                          {isAdmin && <td className="px-3 py-2"><input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} className="w-3.5 h-3.5 accent-[#111110] cursor-pointer" /></td>}
                          <td className="px-3 py-2 font-mono font-semibold text-[#111110]">{r.custom_number?.trim() || `#${r.id}`}</td>
                          <td className="px-3 py-2">
                            <span className="font-medium text-[#111110]">{r.client_name}</span>
                            {r.client_order_number && <span className="text-[10px] text-[#9a9a95] ml-1">кл. {r.client_order_number}</span>}
                          </td>
                          <td className="px-3 py-2 text-[#6b6b66]">{authorOf(r)}</td>
                          <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLE[statusOf(r)] ?? 'bg-[#f0f0ec] text-[#6b6b66]'}`}>{STATUS_LABEL[statusOf(r)] ?? statusOf(r)}</span></td>
                          <td className="px-3 py-2 text-center text-[#6b6b66] whitespace-nowrap">{fmtDate(r.created_at)}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">
                            {fmt(priceOf(r))}
                            {(r.discount_percent ?? 0) > 0 && <span className="text-[10px] text-emerald-600 ml-1">−{r.discount_percent}%</span>}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {view === 'active' ? (
                              <span className="inline-flex items-center gap-0.5">
                                <a href={`/api/quotes/${r.id}/pdf`} target="_blank" download title="Скачать КП (PDF)" className="inline-flex text-[#9a9a95] hover:text-[#111110] p-1.5 rounded hover:bg-[#f5f5f4] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#111110]/15"><IcDownload className="w-4 h-4" /></a>
                                <Link href={`/b2b-quotes/${r.id}/kp`} target="_blank" title="КП для печати" className="text-[11px] font-medium text-[#6b6b66] hover:text-violet-600 px-1.5 py-1 rounded hover:bg-violet-50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#111110]/15">КП</Link>
                                {isAdmin && (
                                  <button onClick={() => { if (window.confirm('Удалить в корзину этот просчёт?')) updateArchived([r.id], true) }} title="Удалить" className="inline-flex text-[#9a9a95] hover:text-red-500 p-1.5 rounded hover:bg-red-50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-red-300"><IcX className="w-4 h-4" /></button>
                                )}
                              </span>
                            ) : isAdmin && (
                              <span className="inline-flex items-center gap-2">
                                <button onClick={() => updateArchived([r.id], false)} className="text-[11px] text-blue-600 hover:text-blue-800">Восстановить</button>
                                <button onClick={() => { if (window.confirm('Удалить НАВСЕГДА? Восстановить нельзя.')) purgeIds([r.id]) }} className="text-[11px] text-red-600 hover:text-red-800">Навсегда</button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
