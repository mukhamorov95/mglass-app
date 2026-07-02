'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import {
  PageHeader, SegmentedTabs, Field, SelectField, SectionHeader, RowCard,
  StatusPill, EmptyState, SkeletonRows, IconButton,
  IcArrowLeft, IcDownload, IcX, IcArchive, IcSearch, type PillTone,
} from '@/components/ds'

// Архив расчётов B2B — полная история просчётов, сделанных людьми (created_by задан;
// импорт из таблицы сюда не попадает). Группировка по месяцам (новые сверху, текущий
// раскрыт), фильтры (период / кто считал / клиент), удаление админом (по одному,
// массово, целым месяцем — мягко, в Корзину с возможностью восстановить).
// Эталонная страница дизайн-системы (Вариант 3) — построена на components/ds.tsx.

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
const priceOf = (r: Row) => (r.discount_percent ?? 0) > 0 ? (r.total_after_discount ?? 0) : (r.total_sale_inc_vat ?? 0)
const statusOf = (r: Row) => (parseNotes(r.notes).status as string | undefined) || 'quote'
const STATUS_LABEL: Record<string, string> = { quote: 'Черновик', pending_approval: 'На согласовании', agreed: 'Согласован', rejected: 'Отказ', sent: 'В работе', confirmed: 'Запущен' }
const STATUS_TONE: Record<string, PillTone> = { quote: 'neutral', pending_approval: 'warning', agreed: 'success', rejected: 'danger', sent: 'accent', confirmed: 'strong' }

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
      {toast && <div className="fixed top-4 right-4 z-50 bg-ink text-white text-[12px] px-4 py-2.5 rounded-xl shadow-lg">{toast}</div>}

      <PageHeader
        title="Архив расчётов B2B"
        subtitle={`${visible.length} просчётов · история по месяцам`}
        actions={
          <Link href="/b2b-quotes" className="inline-flex items-center gap-1.5 text-[12px] text-ink-soft hover:text-ink px-3 py-1.5 border border-line rounded-lg hover:border-ink transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ink/15">
            <IcArrowLeft className="w-3.5 h-3.5" />Просчёты
          </Link>
        }
      />

      <div className="mb-3">
        <SegmentedTabs
          value={view}
          onChange={(v) => { setView(v); setSelectedIds(new Set()) }}
          tabs={[{ value: 'active', label: `Архив (${activeCount})` }, { value: 'trash', label: `Корзина (${trashCount})` }]}
        />
      </div>

      {/* Фильтры */}
      <div className="flex items-center gap-2 mb-4 flex-wrap bg-surface border border-line rounded-xl px-3 py-2.5">
        <Field icon={<IcSearch className="w-3.5 h-3.5" />} value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: № / клиент" className="w-52" />
        <span className="text-[11px] text-muted">Период:</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-surface border border-line rounded-lg px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10" />
        <span className="text-[11px] text-muted">—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-surface border border-line rounded-lg px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10" />
        <SelectField value={authorFilter} onChange={e => setAuthorFilter(e.target.value)} className="max-w-[170px]">
          <option value="">Кто считал: все</option>
          {authorOptions.map(a => <option key={a} value={a}>{a}</option>)}
        </SelectField>
        <SelectField value={clientFilter} onChange={e => setClientFilter(e.target.value)} className="max-w-[190px]">
          <option value="">Клиент: все</option>
          {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </SelectField>
        {(search || dateFrom || dateTo || authorFilter || clientFilter) && (
          <button onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setAuthorFilter(''); setClientFilter('') }}
            className="text-[11px] text-ink-soft hover:text-ink px-2 py-1.5 rounded-lg border border-line hover:border-ink transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ink/15">Сбросить</button>
        )}
      </div>

      {/* Массовые действия */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl">
          <span className="text-[12px] font-medium text-red-700">Выбрано: {selectedIds.size}</span>
          {view === 'active' ? (
            <button onClick={deleteSelected} disabled={busy} className="text-[12px] font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg disabled:opacity-40">Удалить выбранные</button>
          ) : (
            <>
              <button onClick={() => updateArchived([...selectedIds], false)} disabled={busy} className="text-[12px] font-medium text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg disabled:opacity-40">Восстановить</button>
              <button onClick={purgeSelected} disabled={busy} className="text-[12px] font-medium text-white bg-red-700 hover:bg-red-800 px-3 py-1.5 rounded-lg disabled:opacity-40">Удалить навсегда</button>
            </>
          )}
          <button onClick={() => setSelectedIds(new Set())} className="text-[12px] text-ink-soft hover:text-ink ml-auto">Отмена</button>
        </div>
      )}

      {loading ? (
        <SkeletonRows count={4} />
      ) : monthGroups.length === 0 ? (
        <EmptyState
          icon={<IcArchive className="w-8 h-8" />}
          title={view === 'trash' ? 'Корзина пуста' : 'Просчётов пока нет'}
          hint={view === 'trash' ? 'Удалённые просчёты появятся здесь' : 'Здесь копится история просчётов B2B по месяцам'}
          action={view === 'active'
            ? <Link href="/b2b-quotes" className="inline-flex items-center gap-1.5 text-[12px] text-ink-soft hover:text-ink px-3 py-1.5 border border-line rounded-lg hover:border-ink transition-colors"><IcArrowLeft className="w-3.5 h-3.5" />К просчётам</Link>
            : undefined}
        />
      ) : (
        <div className="space-y-6">
          {monthGroups.map(g => {
            const open = expandedMonths.has(g.key)
            const ids = g.rows.map(r => r.id)
            const allSel = ids.length > 0 && ids.every(id => selectedIds.has(id))
            return (
              <div key={g.key}>
                <div className="pb-2 border-b border-line-soft">
                  <SectionHeader
                    title={g.label}
                    meta={`${g.rows.length} просч. · ${fmt(g.total)}`}
                    open={open}
                    onToggle={() => toggleMonth(g.key)}
                    actions={isAdmin ? (
                      <>
                        <button onClick={() => toggleMonthSelect(g.rows)} className="text-[11px] text-ink-soft hover:text-ink px-2 py-1 rounded-lg border border-line hover:border-ink transition-colors">{allSel ? 'Снять' : 'Выбрать всё'}</button>
                        {view === 'active' && (
                          <button onClick={() => deleteMonth(g)} disabled={busy} className="text-[11px] text-red-600 hover:text-red-800 px-2 py-1 rounded-lg border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-40">Удалить месяц</button>
                        )}
                      </>
                    ) : undefined}
                  />
                </div>
                {open && (
                  <div className="space-y-2 mt-3">
                    {g.rows.map(r => (
                      <RowCard
                        key={r.id}
                        selected={selectedIds.has(r.id)}
                        leading={isAdmin ? <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} className="w-3.5 h-3.5 accent-[#111110] cursor-pointer" /> : undefined}
                        title={<><span className="font-medium">{r.client_name}</span> <span className="font-mono text-[12px] text-muted">{r.custom_number?.trim() || `#${r.id}`}</span>{r.client_order_number && <span className="text-[11px] text-muted ml-1">кл. {r.client_order_number}</span>}</>}
                        subtitle={`${authorOf(r)} · ${fmtDate(r.created_at)}`}
                        pill={<StatusPill tone={STATUS_TONE[statusOf(r)] ?? 'neutral'}>{STATUS_LABEL[statusOf(r)] ?? statusOf(r)}</StatusPill>}
                        amount={fmt(priceOf(r))}
                        amountSub={(r.discount_percent ?? 0) > 0 ? <span className="text-emerald-600">−{r.discount_percent}%</span> : undefined}
                        actions={view === 'active' ? (
                          <>
                            <IconButton href={`/api/quotes/${r.id}/pdf`} target="_blank" download title="Скачать КП (PDF)"><IcDownload className="w-4 h-4" /></IconButton>
                            <Link href={`/b2b-quotes/${r.id}/kp`} target="_blank" title="КП для печати" className="text-[11px] font-medium text-ink-soft hover:text-violet-600 px-1.5 py-1 rounded hover:bg-violet-50 transition-colors">КП</Link>
                            {isAdmin && (
                              <IconButton tone="danger" title="Удалить" onClick={() => { if (window.confirm('Удалить в корзину этот просчёт?')) updateArchived([r.id], true) }}><IcX className="w-4 h-4" /></IconButton>
                            )}
                          </>
                        ) : isAdmin ? (
                          <>
                            <button onClick={() => updateArchived([r.id], false)} className="text-[11px] text-blue-600 hover:text-blue-800 px-1.5">Восстановить</button>
                            <button onClick={() => { if (window.confirm('Удалить НАВСЕГДА? Восстановить нельзя.')) purgeIds([r.id]) }} className="text-[11px] text-red-600 hover:text-red-800 px-1.5">Навсегда</button>
                          </>
                        ) : undefined}
                      />
                    ))}
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
