'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// B2B Клиенты (админ). Справочник: сортировка по объёму (сумма/кол-во заказов),
// по умолчанию от крупнейшего клиента вниз; выдача доступа в кабинет прямо здесь
// (email → ссылка set-password, пароль задаёт клиент). Статистика: только РЕАЛЬНЫЕ
// заказы (launched_at IS NOT NULL) — просчёты не считаются.

type Row = {
  id: number; name: string; contact: string | null; phone: string | null
  discount: number; active: boolean; notes: string | null
  ordersCount: number; sumTotal: number; sumYear: number; lastOrderAt: string | null
  linked: boolean; email: string | null; canSelfInvoice: boolean
  members: { userId: string; email: string | null }[]
}
type SortKey = 'sum' | 'count' | 'name' | 'last' | 'discount'
type MonthStats = { [clientId: number]: { [month: number]: number } }

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const EMPTY = { name: '', contact: null as string | null, phone: null as string | null, discount_percent: 0, active: true, notes: null as string | null }

const fmtMoney = (n: number) => n > 0 ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—'
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

export default function B2BClientsPage() {
  const [tab, setTab] = useState<'clients' | 'stats'>('clients')

  // ── Справочник (сводка) ──
  const [rows, setRows] = useState<Row[]>([])
  const [loadingRows, setLoadingRows] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('sum')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [onlyActive, setOnlyActive] = useState(false)

  // ── Форма добавления/редактирования ──
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  // ── Выдача доступа ──
  const [grantId, setGrantId] = useState<number | null>(null)
  const [grantEmail, setGrantEmail] = useState('')
  const [grantBusy, setGrantBusy] = useState(false)
  const [grantErr, setGrantErr] = useState<string | null>(null)
  const [grantLink, setGrantLink] = useState<{ name: string; link: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // ── Статистика ──
  const [statsYear, setStatsYear] = useState(new Date().getFullYear())
  const [stats, setStats] = useState<MonthStats>({})
  const [statNames, setStatNames] = useState<Record<number, string>>({})
  const [statsLoading, setStatsLoading] = useState(false)

  // ── Приглашённые партнёры без компании ──
  const [unlinked, setUnlinked] = useState<{ userId: string; email: string | null; name: string | null }[]>([])
  const [attachTo, setAttachTo] = useState<Record<string, string>>({})   // userId → clientId
  const [attachBusy, setAttachBusy] = useState<string | null>(null)

  function loadOverview() {
    setLoadingRows(true)
    fetch('/api/admin/b2b-clients/overview')
      .then(r => r.json()).then(d => { setRows((d.clients ?? []) as Row[]); setUnlinked(d.unlinkedPartners ?? []) })
      .catch(() => setRows([])).finally(() => setLoadingRows(false))
  }
  async function attachPartner(userId: string) {
    const clientId = Number(attachTo[userId])
    if (!clientId) return
    setAttachBusy(userId)
    try {
      const r = await fetch('/api/admin/b2b-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link_existing', clientId, userId }),
      })
      const d = await r.json()
      if (!r.ok) { alert(d.error || 'Не удалось привязать'); return }
      loadOverview()
    } finally { setAttachBusy(null) }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadOverview() }, [])

  async function loadStats() {
    setStatsLoading(true)
    const supabase = createClient()
    const from = `${statsYear}-01-01`, to = `${statsYear}-12-31`
    const { data } = await supabase
      .from('b2b_orders')
      .select('client_id, client_name, total_after_discount, created_at')
      .not('launched_at', 'is', null)   // только реальные заказы — просчёты не считаем
      .gte('created_at', from).lte('created_at', to + 'T23:59:59')

    const result: MonthStats = {}
    const names: Record<number, string> = {}
    ;(data ?? []).forEach((row: { client_id: number; client_name: string; total_after_discount: number | null; created_at: string }) => {
      const m = new Date(row.created_at).getMonth()
      if (!result[row.client_id]) result[row.client_id] = {}
      result[row.client_id][m] = (result[row.client_id][m] ?? 0) + (row.total_after_discount ?? 0)
      names[row.client_id] = row.client_name
    })
    setStats(result); setStatNames(names); setStatsLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'stats') loadStats() }, [tab, statsYear])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const arr = rows.filter(r => (!onlyActive || r.active) && (!q || r.name.toLowerCase().includes(q) || (r.email ?? '').toLowerCase().includes(q)))
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      let d = 0
      if (sortKey === 'name') d = a.name.localeCompare(b.name, 'ru')
      else if (sortKey === 'sum') d = a.sumTotal - b.sumTotal
      else if (sortKey === 'count') d = a.ordersCount - b.ordersCount
      else if (sortKey === 'discount') d = a.discount - b.discount
      else if (sortKey === 'last') d = (a.lastOrderAt ? +new Date(a.lastOrderAt) : 0) - (b.lastOrderAt ? +new Date(b.lastOrderAt) : 0)
      return d * dir
    })
    return arr
  }, [rows, sortKey, sortDir, search, onlyActive])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc') }
  }
  const arrow = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true); setError(null)
    const supabase = createClient()
    const payload = { ...form, discount_percent: Number(form.discount_percent) }
    const { error } = editingId !== null
      ? await supabase.from('b2b_clients').update(payload).eq('id', editingId)
      : await supabase.from('b2b_clients').insert(payload)
    if (error) { setError(error.message); setSaving(false); return }
    setEditingId(null); setForm(EMPTY); setSaving(false); loadOverview()
  }

  async function toggleActive(id: number, active: boolean) {
    await createClient().from('b2b_clients').update({ active: !active }).eq('id', id)
    loadOverview()
  }

  function startEdit(r: Row) {
    setEditingId(r.id)
    setForm({ name: r.name, contact: r.contact, phone: r.phone, discount_percent: r.discount, active: r.active, notes: r.notes })
    setError(null); setTab('clients')
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  async function grant(r: Row) {
    if (!grantEmail.trim()) { setGrantErr('Укажите email'); return }
    setGrantBusy(true); setGrantErr(null)
    try {
      const res = await fetch('/api/admin/b2b-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: r.id, email: grantEmail.trim() }),
      })
      const d = await res.json()
      if (!res.ok) { setGrantErr(d.error || 'Ошибка'); return }
      setGrantLink({ name: r.name, link: d.link }); setCopied(false)
      setGrantId(null); setGrantEmail(''); loadOverview()
    } catch { setGrantErr('Сеть недоступна') } finally { setGrantBusy(false) }
  }
  async function revoke(r: Row) {
    if (!confirm(`Отозвать доступ в кабинет у «${r.name}»? Клиент больше не сможет войти.`)) return
    await fetch('/api/admin/b2b-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlink', clientId: r.id }),
    })
    loadOverview()
  }
  // A6: убрать сотрудника из команды компании (первичный владелец — через «Отозвать»).
  async function removeMember(clientId: number, userId: string) {
    if (!confirm('Убрать этого сотрудника из доступа к кабинету?')) return
    await fetch('/api/admin/b2b-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove_member', clientId, userId }),
    })
    loadOverview()
  }
  // Разрешить/запретить клиенту самому скачивать счёт-спецификацию (после проверки паритета).
  async function toggleSelfInvoice(r: Row) {
    if (!r.canSelfInvoice && !confirm(`Разрешить «${r.name}» самому скачивать счёт-спецификацию из кабинета?\n\nВключайте, когда убедились, что расчёты клиента совпадают с нашими.`)) return
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, canSelfInvoice: !x.canSelfInvoice } : x))
    await fetch('/api/admin/b2b-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_self_invoice', clientId: r.id, value: !r.canSelfInvoice }),
    }).catch(() => loadOverview())
  }

  const statIds = Object.keys(stats).map(Number)
    .filter(id => Object.values(stats[id]).some(v => v > 0))
    .sort((a, b) => Object.values(stats[b] ?? {}).reduce((s, v) => s + v, 0) - Object.values(stats[a] ?? {}).reduce((s, v) => s + v, 0))

  const th = 'text-left px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest'
  const sortableTh = (k: SortKey, label: string, extra = '') =>
    <th className={`${th} ${extra} cursor-pointer select-none hover:text-[#111110]`} onClick={() => toggleSort(k)}>{label}{arrow(k)}</th>

  return (
    <div className="max-w-[1180px] mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">B2B Клиенты</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">{rows.length} клиентов · {rows.filter(c => c.linked).length} с доступом в кабинет</p>
        </div>
        <div className="flex bg-[#f0f0ec] rounded-lg p-0.5">
          <button onClick={() => setTab('clients')} className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all ${tab === 'clients' ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66]'}`}>Справочник</button>
          <button onClick={() => setTab('stats')} className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all ${tab === 'stats' ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66]'}`}>Статистика</button>
        </div>
      </div>

      {/* Баннер после выдачи доступа */}
      {grantLink && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-[13px] font-semibold text-emerald-800">Доступ выдан — «{grantLink.name}»</p>
          <p className="text-[12px] text-emerald-700 mt-0.5">Отправьте клиенту ссылку — он сам задаст пароль и войдёт в кабинет:</p>
          <div className="flex items-center gap-2 mt-2">
            <input readOnly value={grantLink.link} className="flex-1 bg-white border border-emerald-200 rounded-lg px-3 py-1.5 text-[12px] text-[#111110] font-mono" />
            <button onClick={() => { navigator.clipboard?.writeText(grantLink.link); setCopied(true) }}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">{copied ? 'Скопировано ✓' : 'Копировать'}</button>
            <button onClick={() => setGrantLink(null)} className="text-[12px] text-emerald-700 px-2">✕</button>
          </div>
        </div>
      )}

      {/* ══ СПРАВОЧНИК ══ */}
      {tab === 'clients' && (
        <>
          {unlinked.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-6">
              <p className="text-[13px] font-semibold text-amber-900">Приглашённые партнёры без компании — {unlinked.length}</p>
              <p className="text-[12px] text-amber-800 mt-0.5 mb-3">Эти пользователи получили роль «Клиент B2B», но не привязаны к заказчику — их кабинет будет пустым. Привяжите каждого к его компании.</p>
              <div className="flex flex-col gap-2">
                {unlinked.map(u => (
                  <div key={u.userId} className="flex flex-wrap items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                    <span className="text-[13px] font-medium text-[#111110]">{u.email ?? u.name ?? u.userId.slice(0, 8)}</span>
                    <select value={attachTo[u.userId] ?? ''} onChange={e => setAttachTo(m => ({ ...m, [u.userId]: e.target.value }))}
                      className="ml-auto bg-white border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#111110] max-w-[240px]">
                      <option value="">— выберите компанию —</option>
                      {rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <button onClick={() => attachPartner(u.userId)} disabled={!attachTo[u.userId] || attachBusy === u.userId}
                      className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 whitespace-nowrap">
                      {attachBusy === u.userId ? '…' : 'Привязать'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div ref={formRef} className={`rounded-xl border p-5 mb-6 transition-all ${editingId !== null ? 'bg-blue-50 border-blue-200' : 'bg-white border-[#e4e4e0]'}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">{editingId !== null ? `Редактировать — ID ${editingId}` : 'Добавить клиента'}</h2>
              {editingId !== null && <span className="text-[11px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">Режим редактирования</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Название / ИП / ООО</label>
                <input className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110]" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="ООО «Стекло плюс»" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Контактное лицо</label>
                <input className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110]" value={form.contact ?? ''} onChange={e => setForm({ ...form, contact: e.target.value || null })} placeholder="Иван Петров" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Телефон</label>
                <input className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110]" value={form.phone ?? ''} onChange={e => setForm({ ...form, phone: e.target.value || null })} placeholder="+7 900 000-00-00" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Скидка (%)</label>
                <input type="number" min="0" max="100" step="0.5" className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-[#111110]" value={form.discount_percent} onChange={e => setForm({ ...form, discount_percent: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Примечание</label>
                <input className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110]" value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value || null })} placeholder="Необязательно" />
              </div>
            </div>
            {error && <p className="mt-3 text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={handleSave} disabled={saving || !form.name.trim()} className="bg-[#111110] text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">{saving ? 'Сохранение...' : editingId !== null ? 'Сохранить' : 'Добавить'}</button>
              {editingId !== null && <button onClick={() => { setEditingId(null); setForm(EMPTY); setError(null) }} className="bg-[#f0f0ec] text-[#111110] text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4]">Отмена</button>}
            </div>
          </div>

          {/* Поиск + фильтр */}
          <div className="flex items-center gap-3 mb-3">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по названию или email…"
              className="flex-1 bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" />
            <label className="flex items-center gap-1.5 text-[12px] text-[#6b6b66] cursor-pointer select-none">
              <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} className="accent-[#111110]" /> Только активные
            </label>
          </div>

          <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto">
            {loadingRows ? <div className="p-8 text-center text-[13px] text-[#8a8a85]">Загрузка…</div>
              : shown.length === 0 ? <div className="p-8 text-center text-[13px] text-[#8a8a85]">Ничего не найдено</div>
              : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[#f0f0ec]">
                      {sortableTh('name', 'Клиент')}
                      {sortableTh('count', 'Заказов', 'text-right')}
                      {sortableTh('sum', 'Сумма', 'text-right')}
                      {sortableTh('last', 'Последний', 'text-right')}
                      {sortableTh('discount', 'Скидка', 'text-center')}
                      <th className={th}>Доступ в кабинет</th>
                      <th className="w-28 px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(c => (
                      <tr key={c.id} className={`border-b border-[#f8f8f7] last:border-0 transition-colors ${editingId === c.id ? 'bg-blue-50' : 'hover:bg-[#fafaf9]'} ${!c.active ? 'opacity-40' : ''}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#111110]">{c.name}</p>
                          {c.contact && <p className="text-[12px] text-[#9a9a95] mt-0.5">{c.contact}{c.phone ? ` · ${c.phone}` : ''}</p>}
                          {c.notes && <p className="text-[12px] text-[#c4c4be] mt-0.5">{c.notes}</p>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-[#111110]">{c.ordersCount || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-[#111110]">
                          {fmtMoney(c.sumTotal)}
                          {c.sumYear > 0 && <span className="block text-[11px] text-[#9a9a95]">за год {fmtMoney(c.sumYear)}</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-[#6b6b66] whitespace-nowrap">{fmtDate(c.lastOrderAt)}</td>
                        <td className="px-4 py-3 text-center">{c.discount > 0 ? <span className="font-mono font-semibold text-emerald-600">{c.discount}%</span> : <span className="text-[#c4c4be]">—</span>}</td>
                        <td className="px-4 py-3">
                          {c.linked ? (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">✓ {c.email ?? 'выдан'}</span>
                                {c.members.map(m => (
                                  <span key={m.userId} className="text-[11px] text-[#4b4b47] bg-[#f0f0ec] border border-[#e4e4e0] rounded-full px-2 py-0.5 flex items-center gap-1">
                                    {m.email ?? 'сотрудник'}
                                    <button onClick={() => removeMember(c.id, m.userId)} className="text-[#9a9a95] hover:text-red-500" title="Убрать сотрудника">✕</button>
                                  </span>
                                ))}
                                <button onClick={() => revoke(c)} className="text-[11px] text-[#9a9a95] hover:text-red-500">Отозвать</button>
                              </div>
                              {grantId === c.id ? (
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <input value={grantEmail} onChange={e => { setGrantEmail(e.target.value); setGrantErr(null) }} autoFocus placeholder="email сотрудника"
                                      onKeyDown={e => { if (e.key === 'Enter') grant(c) }}
                                      className="bg-white border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#111110] w-44" />
                                    <button onClick={() => grant(c)} disabled={grantBusy} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 whitespace-nowrap">{grantBusy ? '…' : 'Добавить'}</button>
                                    <button onClick={() => { setGrantId(null); setGrantEmail(''); setGrantErr(null) }} className="text-[12px] text-[#9a9a95] px-1">✕</button>
                                  </div>
                                  {grantErr && <p className="text-[11px] text-red-500 mt-1">{grantErr}</p>}
                                </div>
                              ) : (
                                <button onClick={() => { setGrantId(c.id); setGrantEmail(''); setGrantErr(null) }} className="text-[11px] text-blue-600 hover:text-blue-800 self-start">＋ сотрудник</button>
                              )}
                              <button onClick={() => toggleSelfInvoice(c)}
                                className={`text-[11px] self-start rounded-full px-2 py-0.5 border transition-colors ${c.canSelfInvoice ? 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100' : 'text-[#9a9a95] bg-[#f8f8f7] border-[#e4e4e0] hover:border-[#c4c4be]'}`}
                                title="Клиент может сам скачивать счёт-спецификацию из кабинета">
                                {c.canSelfInvoice ? '📄 Счёт клиенту: вкл' : '📄 Счёт клиенту: выкл'}
                              </button>
                            </div>
                          ) : grantId === c.id ? (
                            <div>
                              <div className="flex items-center gap-1.5">
                                <input value={grantEmail} onChange={e => { setGrantEmail(e.target.value); setGrantErr(null) }} autoFocus placeholder="email клиента"
                                  onKeyDown={e => { if (e.key === 'Enter') grant(c) }}
                                  className="bg-white border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#111110] w-44" />
                                <button onClick={() => grant(c)} disabled={grantBusy} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 whitespace-nowrap">{grantBusy ? '…' : 'Выдать'}</button>
                                <button onClick={() => { setGrantId(null); setGrantEmail(''); setGrantErr(null) }} className="text-[12px] text-[#9a9a95] px-1">✕</button>
                              </div>
                              {grantErr && <p className="text-[11px] text-red-500 mt-1">{grantErr}</p>}
                            </div>
                          ) : (
                            <button onClick={() => { setGrantId(c.id); setGrantEmail(''); setGrantErr(null) }} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800">＋ Выдать доступ</button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 justify-end">
                            <button onClick={() => startEdit(c)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800">Изменить</button>
                            <button onClick={() => toggleActive(c.id, c.active)} className="text-[12px] text-[#9a9a95] hover:text-[#6b6b66]">{c.active ? 'Скрыть' : 'Показать'}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
          <p className="text-[11px] text-[#c4c4be] mt-2">Сумма и «Заказов» — по реальным заказам (запущенным в работу). Просчёты не учитываются. Нажмите на заголовок столбца для сортировки.</p>
        </>
      )}

      {/* ══ СТАТИСТИКА ══ */}
      {tab === 'stats' && (
        <div>
          <div className="flex items-center gap-3 mb-5">
            <label className="text-[13px] font-medium text-[#6b6b66]">Год:</label>
            <select className="bg-white border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[14px] text-[#111110] outline-none focus:border-[#111110]" value={statsYear} onChange={e => setStatsYear(Number(e.target.value))}>
              {Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="text-[12px] text-[#9a9a95]">Только реальные заказы (без просчётов), от крупнейших клиентов</span>
          </div>

          {statsLoading ? <div className="p-8 text-center text-[13px] text-[#8a8a85]">Загрузка…</div>
            : statIds.length === 0 ? <div className="p-12 text-center text-[13px] text-[#8a8a85] bg-white border border-[#e4e4e0] rounded-xl">Нет заказов за {statsYear} год</div>
            : (
              <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[#f0f0ec]">
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest sticky left-0 bg-white">Клиент</th>
                      {MONTHS.map((m, i) => <th key={i} className="text-right px-3 py-3 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest whitespace-nowrap">{m}</th>)}
                      <th className="text-right px-4 py-3 text-[11px] font-semibold text-[#111110] uppercase tracking-widest whitespace-nowrap">Год</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statIds.map(id => {
                      const md = stats[id] ?? {}
                      const yearTotal = Object.values(md).reduce((s, v) => s + v, 0)
                      return (
                        <tr key={id} className="border-b border-[#f8f8f7] last:border-0 hover:bg-[#fafaf9]">
                          <td className="px-4 py-3 font-medium text-[#111110] sticky left-0 bg-white whitespace-nowrap">{statNames[id] ?? `Клиент #${id}`}</td>
                          {Array.from({ length: 12 }, (_, m) => <td key={m} className="px-3 py-3 text-right font-mono text-[#6b6b66] whitespace-nowrap">{md[m] ? Math.round(md[m]).toLocaleString('ru-RU') : '—'}</td>)}
                          <td className="px-4 py-3 text-right font-mono font-bold text-[#111110] whitespace-nowrap">{Math.round(yearTotal).toLocaleString('ru-RU')} ₽</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[#e4e4e0] bg-[#f8f8f7]">
                      <td className="px-4 py-3 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest sticky left-0 bg-[#f8f8f7]">Итого</td>
                      {Array.from({ length: 12 }, (_, m) => {
                        const total = statIds.reduce((s, id) => s + (stats[id]?.[m] ?? 0), 0)
                        return <td key={m} className="px-3 py-3 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">{total > 0 ? Math.round(total).toLocaleString('ru-RU') : '—'}</td>
                      })}
                      <td className="px-4 py-3 text-right font-mono font-bold text-[#111110] whitespace-nowrap">{Math.round(statIds.reduce((s, id) => s + Object.values(stats[id] ?? {}).reduce((a, b) => a + b, 0), 0)).toLocaleString('ru-RU')} ₽</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </div>
      )}
    </div>
  )
}
