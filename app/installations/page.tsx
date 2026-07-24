'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Монтажи — одно окно отдела реализации: заявка на монтаж (один заказ = одна
// задача бригаде) по устоявшейся форме компании, копия в чат монтажной группы
// одним нажатием, ссылка в Google Календарь, статусы назначен/закрыт и сводка
// по бригадам. Фаза 2 — кабинет монтажника, фаза 3 — выплаты и маржа объекта.

type Crew = { id: number; name: string; members: string | null; active: boolean }
type Inst = {
  id: number
  order_no: string
  title: string | null
  client_name: string | null
  phone: string | null
  address: string | null
  entry_note: string | null
  scheduled_date: string | null
  time_from: string | null
  time_to: string | null
  contact_before: string | null
  crew_id: number | null
  amount: number | null
  order_total: number | null
  comment: string | null
  status: 'planned' | 'done' | 'canceled'
  closed_at: string | null
  created_by: string | null
  created_at: string
}

const TODAY = new Date().toISOString().slice(0, 10)
const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')
const dayLabel = (d: string) => {
  if (d === TODAY) return 'Сегодня'
  const date = new Date(d + 'T00:00:00')
  const tomorrow = new Date(new Date(TODAY + 'T00:00:00').getTime() + 86400000).toISOString().slice(0, 10)
  const label = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
  return (d === tomorrow ? 'Завтра · ' : '') + label.charAt(0).toUpperCase() + label.slice(1)
}

const EMPTY_FORM = {
  order_no: '', title: '', client_name: '', phone: '', address: '', entry_note: '',
  scheduled_date: '', time_from: '', time_to: '', contact_before: 'за 30 минут',
  crew_id: '' as string, amount: '', order_total: '', comment: '',
}

// Текст заявки для чата монтажной группы — та же форма, что компания шлёт руками
function chatText(i: Inst, crewName: string | null): string {
  const dt = i.scheduled_date ? dayLabel(i.scheduled_date) : ''
  const window = [i.time_from, i.time_to].filter(Boolean).join('–')
  const lines = [
    `#${i.order_no}${i.title ? ` ${i.title}` : ''}`,
    [dt, window].filter(Boolean).join(' ⋅ '),
    '',
    `Номер заказа: #${i.order_no}`,
    crewName ? `Бригада: ${crewName}` : null,
    i.title ? `Изделие: ${i.title}` : null,
    i.client_name ? `ФИО: ${i.client_name}` : null,
    i.address ? `Адрес: ${i.address}` : null,
    i.entry_note ? `Пропуск: ${i.entry_note}` : null,
    i.phone ? `Телефон: ${i.phone}` : null,
    i.amount != null ? `Сумма монтажа: ${RUB(Number(i.amount))}` : null,
    i.contact_before ? `Связаться с клиентом: ${i.contact_before}` : null,
    i.comment ? `Комментарий: ${i.comment}` : null,
  ].filter(x => x !== null)
  return lines.join('\n')
}

function gcalUrl(i: Inst, crewName: string | null): string {
  const d = (i.scheduled_date ?? TODAY).replaceAll('-', '')
  const t1 = (i.time_from ?? '10:00').replace(':', '') + '00'
  const t2 = (i.time_to ?? (i.time_from ? `${String(Number(i.time_from.slice(0, 2)) + 1).padStart(2, '0')}${i.time_from.slice(2)}` : '11:00')).replace(':', '') + '00'
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `#${i.order_no}${i.title ? ` ${i.title}` : ''}`,
    dates: `${d}T${t1}/${d}T${t2}`,
    details: chatText(i, crewName),
    location: i.address ?? '',
  })
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

export default function InstallationsPage() {
  const sb = createClient()
  const [crews, setCrews] = useState<Crew[]>([])
  const [insts, setInsts] = useState<Inst[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [editId, setEditId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [me, setMe] = useState<string>('')
  const [filterCrew, setFilterCrew] = useState<'all' | number>('all')
  const [filterStatus, setFilterStatus] = useState<'active' | 'done' | 'all'>('active')
  const [newCrew, setNewCrew] = useState('')
  const [crewsOpen, setCrewsOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Голосовой ввод заявки: зажал → надиктовал → поля заполнились сами
  // (Whisper → Claude, /api/installations/parse-voice). Заполняются только
  // ПУСТЫЕ поля — ручной ввод не затирается.
  const [recState, setRecState] = useState<'idle' | 'rec' | 'busy'>('idle')
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function voiceStart() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: mime })
        if (blob.size < 2000) { setRecState('idle'); return }
        setRecState('busy')
        const fd = new FormData()
        fd.append('audio', blob, mime.includes('mp4') ? 'note.mp4' : 'note.webm')
        const r = await fetch('/api/installations/parse-voice', { method: 'POST', body: fd })
        const d = await r.json().catch(() => ({}))
        setRecState('idle')
        if (!r.ok) { flash(d.error ?? 'Не разобралось — попробуй ещё раз'); return }
        const f = (d.fields ?? {}) as Record<string, unknown>
        const str = (v: unknown) => (v == null ? '' : String(v))
        setForm(prev => ({
          ...prev,
          order_no:       prev.order_no       || str(f.order_no).replace(/^#/, ''),
          title:          prev.title          || str(f.title),
          client_name:    prev.client_name    || str(f.client_name),
          phone:          prev.phone          || str(f.phone),
          address:        prev.address        || str(f.address),
          entry_note:     prev.entry_note     || str(f.entry_note),
          scheduled_date: prev.scheduled_date || (/^\d{4}-\d{2}-\d{2}$/.test(str(f.scheduled_date)) ? str(f.scheduled_date) : ''),
          time_from:      prev.time_from      || (/^\d{2}:\d{2}$/.test(str(f.time_from)) ? str(f.time_from) : ''),
          time_to:        prev.time_to        || (/^\d{2}:\d{2}$/.test(str(f.time_to)) ? str(f.time_to) : ''),
          contact_before: str(f.contact_before) || prev.contact_before,
          amount:         prev.amount         || (f.amount != null ? String(f.amount) : ''),
          order_total:    prev.order_total    || (f.order_total != null ? String(f.order_total) : ''),
          comment:        prev.comment        || str(f.comment),
        }))
        const n = Object.values(f).filter(v => v != null && v !== '').length
        flash(`Заполнено полей из голоса: ${n} — проверь и сохрани`)
      }
      rec.start()
      recRef.current = rec
      setRecState('rec')
    } catch { flash('Нет доступа к микрофону') }
  }
  function voiceStop() { recRef.current?.stop() }

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1800) }

  // Предзаполнение из карточки заказа/КП: /installations?order_no&client_name&…
  // Открываем форму сразу заполненной. window.location вместо useSearchParams —
  // чтобы не тянуть Suspense-границу в client-компонент.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const keys = ['order_no', 'client_name', 'phone', 'address', 'order_total', 'title'] as const
    if (!keys.some(k => sp.get(k))) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- разовое предзаполнение из URL после маунта (window нет на сервере)
    setForm(f => ({
      ...f,
      order_no:    sp.get('order_no')    ?? f.order_no,
      client_name: sp.get('client_name') ?? f.client_name,
      phone:       sp.get('phone')       ?? f.phone,
      address:     sp.get('address')     ?? f.address,
      order_total: sp.get('order_total') ?? f.order_total,
      title:       sp.get('title')       ?? f.title,
    }))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormOpen(true)
  }, [])

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await sb.auth.getUser()
      if (user) {
        const { data: p } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
        setMe((p as { name: string | null } | null)?.name ?? user.email ?? '')
      }
      const monthAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)
      const [{ data: cs }, { data: rows }] = await Promise.all([
        sb.from('installation_crews').select('*').order('name'),
        sb.from('installations').select('*')
          .or(`status.eq.planned,scheduled_date.gte.${monthAgo}`)
          .order('scheduled_date', { ascending: true, nullsFirst: false })
          .order('time_from', { ascending: true }),
      ])
      setCrews((cs ?? []) as Crew[])
      setInsts((rows ?? []) as Inst[])
    } finally { setLoading(false) }
  }, [sb])
  useEffect(() => { void load() }, [load])

  const crewName = (id: number | null) => crews.find(c => c.id === id)?.name ?? null

  function openCreate() { setForm({ ...EMPTY_FORM }); setEditId(null); setFormOpen(true) }
  function openEdit(i: Inst) {
    setForm({
      order_no: i.order_no, title: i.title ?? '', client_name: i.client_name ?? '', phone: i.phone ?? '',
      address: i.address ?? '', entry_note: i.entry_note ?? '', scheduled_date: i.scheduled_date ?? '',
      time_from: i.time_from ?? '', time_to: i.time_to ?? '', contact_before: i.contact_before ?? '',
      crew_id: i.crew_id != null ? String(i.crew_id) : '', amount: i.amount != null ? String(i.amount) : '',
      order_total: i.order_total != null ? String(i.order_total) : '', comment: i.comment ?? '',
    })
    setEditId(i.id); setFormOpen(true)
  }

  async function save() {
    if (!form.order_no.trim()) { flash('Укажите номер заказа'); return }
    setSaving(true)
    try {
      const row = {
        order_no: form.order_no.trim().replace(/^#/, ''),
        title: form.title.trim() || null,
        client_name: form.client_name.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        entry_note: form.entry_note.trim() || null,
        scheduled_date: form.scheduled_date || null,
        time_from: form.time_from || null,
        time_to: form.time_to || null,
        contact_before: form.contact_before.trim() || null,
        crew_id: form.crew_id ? Number(form.crew_id) : null,
        amount: form.amount !== '' ? Number(form.amount) : null,
        order_total: form.order_total !== '' ? Number(form.order_total) : null,
        comment: form.comment.trim() || null,
      }
      if (editId != null) {
        const { error } = await sb.from('installations').update(row).eq('id', editId)
        if (error) { flash('Ошибка: ' + error.message); return }
      } else {
        const { error } = await sb.from('installations').insert({ ...row, created_by: me || null })
        if (error) { flash('Ошибка: ' + error.message); return }
      }
      setFormOpen(false)
      flash(editId != null ? 'Сохранено' : 'Монтаж создан')
      await load()
    } finally { setSaving(false) }
  }

  async function setStatus(i: Inst, status: Inst['status']) {
    await sb.from('installations').update({
      status,
      closed_at: status === 'done' ? new Date().toISOString() : null,
    }).eq('id', i.id)
    flash(status === 'done' ? `#${i.order_no} закрыт` : status === 'canceled' ? 'Отменён' : 'Возвращён в работу')
    await load()
  }

  async function copyChat(i: Inst) {
    try {
      await navigator.clipboard.writeText(chatText(i, crewName(i.crew_id)))
      flash('Скопировано — вставьте в чат')
    } catch { flash('Не удалось скопировать') }
  }

  async function addCrew() {
    if (!newCrew.trim()) return
    await sb.from('installation_crews').insert({ name: newCrew.trim() })
    setNewCrew(''); await load()
  }

  const visible = insts.filter(i =>
    (filterCrew === 'all' || i.crew_id === filterCrew) &&
    (filterStatus === 'all' ? true : filterStatus === 'done' ? i.status === 'done' : i.status === 'planned')
  )
  const byDate = new Map<string, Inst[]>()
  for (const i of visible) {
    const k = i.scheduled_date ?? 'Без даты'
    byDate.set(k, [...(byDate.get(k) ?? []), i])
  }

  // Сводка: неделя (пн–вс) и суммы бригад за текущий месяц по закрытым
  const monday = (() => { const d = new Date(TODAY + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10) })()
  const sunday = (() => { const d = new Date(monday + 'T00:00:00'); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10) })()
  const weekInsts = insts.filter(i => i.scheduled_date && i.scheduled_date >= monday && i.scheduled_date <= sunday && i.status !== 'canceled')
  const monthKey = TODAY.slice(0, 7)
  const crewMonth = new Map<number, number>()
  for (const i of insts) {
    if (i.status !== 'done' || !i.crew_id || (i.scheduled_date ?? '').slice(0, 7) !== monthKey) continue
    crewMonth.set(i.crew_id, (crewMonth.get(i.crew_id) ?? 0) + Number(i.amount ?? 0))
  }

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  const inputCls = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:border-[#111110]'
  const lbl = 'text-[11px] font-medium text-[#6b6b66] mb-1 block'

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{toast}</div>}

      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">🔧 Монтажи</h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">
              На этой неделе: {weekInsts.length} · закрыто {weekInsts.filter(i => i.status === 'done').length}
            </p>
          </div>
          <button onClick={openCreate} className="px-4 py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold hover:opacity-90">
            ＋ Заявка на монтаж
          </button>
        </div>
      </div>

      <div className="px-5 pt-4 max-w-[900px] space-y-4">
        {/* Фильтры */}
        <div className="flex items-center gap-2 flex-wrap">
          {([['active', 'Назначенные'], ['done', 'Закрытые'], ['all', 'Все']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilterStatus(k)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-medium border ${filterStatus === k ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0]'}`}>
              {l}
            </button>
          ))}
          <select value={filterCrew === 'all' ? 'all' : String(filterCrew)} onChange={e => setFilterCrew(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] bg-white ml-auto">
            <option value="all">Все бригады</option>
            {crews.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Форма */}
        {formOpen && (
          <div className="bg-white rounded-xl border border-[#111110] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-bold text-[#111110]">{editId != null ? 'Редактировать монтаж' : 'Новая заявка на монтаж'}</p>
              <button type="button" onClick={recState === 'rec' ? voiceStop : recState === 'idle' ? voiceStart : undefined} disabled={recState === 'busy'}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold ${recState === 'rec' ? 'bg-red-600 text-white animate-pulse' : recState === 'busy' ? 'bg-[#f0f0ec] text-[#9a9a95]' : 'bg-[#111110] text-white'}`}>
                {recState === 'rec' ? '■ Стоп' : recState === 'busy' ? 'Разбираю…' : '🎙 Надиктовать'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div><span className={lbl}>№ заказа *</span><input className={inputCls} value={form.order_no} onChange={e => setForm({ ...form, order_no: e.target.value })} placeholder="0715-2" /></div>
              <div><span className={lbl}>Дата</span><input type="date" className={inputCls} value={form.scheduled_date} onChange={e => setForm({ ...form, scheduled_date: e.target.value })} /></div>
              <div><span className={lbl}>Ждут с</span><input type="time" className={inputCls} value={form.time_from} onChange={e => setForm({ ...form, time_from: e.target.value })} /></div>
              <div><span className={lbl}>до</span><input type="time" className={inputCls} value={form.time_to} onChange={e => setForm({ ...form, time_to: e.target.value })} /></div>
            </div>
            <div><span className={lbl}>Изделие / что монтируем</span><input className={inputCls} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Душевая (заменить дверь)…" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div><span className={lbl}>ФИО клиента</span><input className={inputCls} value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} /></div>
              <div><span className={lbl}>Телефон</span><input className={inputCls} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="8999…" /></div>
            </div>
            <div><span className={lbl}>Адрес *</span><input className={inputCls} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Москва г, …" /></div>
            <div><span className={lbl}>Пропуск / как попасть</span><input className={inputCls} value={form.entry_note} onChange={e => setForm({ ...form, entry_note: e.target.value })} placeholder="позвонить за час, заказать пропуск" /></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <span className={lbl}>Бригада</span>
                <select className={inputCls} value={form.crew_id} onChange={e => setForm({ ...form, crew_id: e.target.value })}>
                  <option value="">—</option>
                  {crews.filter(c => c.active).map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>
              <div><span className={lbl}>Сумма монтажа, ₽</span><input type="number" className={inputCls} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div><span className={lbl}>Сумма заказа, ₽</span><input type="number" className={inputCls} value={form.order_total} onChange={e => setForm({ ...form, order_total: e.target.value })} /></div>
              <div><span className={lbl}>Связаться с клиентом</span><input className={inputCls} value={form.contact_before} onChange={e => setForm({ ...form, contact_before: e.target.value })} placeholder="за 30 минут" /></div>
            </div>
            <div><span className={lbl}>Комментарий</span><input className={inputCls} value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} /></div>
            <div className="flex gap-2">
              <button onClick={save} disabled={saving} className="px-5 py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-50">
                {saving ? 'Сохраняю…' : editId != null ? 'Сохранить' : 'Создать монтаж'}
              </button>
              <button onClick={() => setFormOpen(false)} className="px-4 py-2.5 rounded-xl border border-[#e4e4e0] text-[13px] text-[#6b6b66]">Отмена</button>
            </div>
          </div>
        )}

        {/* Список по дням */}
        {visible.length === 0 && !formOpen && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center text-[13px] text-[#9a9a95]">
            Монтажей нет — создайте первую заявку
          </div>
        )}
        {[...byDate.entries()].map(([date, list]) => (
          <div key={date}>
            <p className={`text-[11px] font-semibold uppercase tracking-widest mb-2 ${date === TODAY ? 'text-red-700' : 'text-[#9a9a95]'}`}>
              {date === 'Без даты' ? 'Без даты' : dayLabel(date)} · {list.length}
            </p>
            <div className="space-y-2">
              {list.map(i => (
                <div key={i.id} className={`bg-white rounded-xl border p-4 ${i.status === 'done' ? 'border-emerald-200 opacity-80' : i.status === 'canceled' ? 'border-[#e4e4e0] opacity-50' : 'border-[#e4e4e0]'}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-[#111110]">
                        {[i.time_from, i.time_to].filter(Boolean).join('–')} · #{i.order_no}
                        {i.status === 'done' && <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">закрыт</span>}
                        {i.status === 'canceled' && <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#f0f0ec] text-[#9a9a95]">отменён</span>}
                      </p>
                      {i.title && <p className="text-[13px] text-[#111110] mt-0.5">{i.title}</p>}
                      <p className="text-[12px] text-[#6b6b66] mt-0.5">
                        {[i.client_name, i.phone].filter(Boolean).join(' · ')}
                      </p>
                      {i.address && <p className="text-[12px] text-[#6b6b66]">{i.address}</p>}
                      {i.entry_note && <p className="text-[11px] text-amber-700 mt-0.5">🔑 {i.entry_note}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {crewName(i.crew_id) && <p className="text-[12px] font-semibold text-[#111110]">👷 {crewName(i.crew_id)}</p>}
                      {i.amount != null && <p className="text-[13px] font-mono text-[#111110] mt-0.5">{RUB(Number(i.amount))} ₽</p>}
                      {i.contact_before && <p className="text-[11px] text-[#9a9a95] mt-0.5">📞 {i.contact_before}</p>}
                    </div>
                  </div>
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    <button onClick={() => copyChat(i)} className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] font-medium text-[#111110] hover:border-[#111110]">📋 Скопировать для чата</button>
                    <a href={gcalUrl(i, crewName(i.crew_id))} target="_blank" rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] font-medium text-[#111110] hover:border-[#111110]">📅 В Google Календарь</a>
                    {i.status === 'planned' && (
                      <button onClick={() => setStatus(i, 'done')} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-medium">✓ Объект закрыт</button>
                    )}
                    {i.status !== 'planned' && (
                      <button onClick={() => setStatus(i, 'planned')} className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66]">↩ В работу</button>
                    )}
                    <button onClick={() => openEdit(i)} className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66] hover:border-[#111110]">✎</button>
                    {i.status === 'planned' && (
                      <button onClick={() => setStatus(i, 'canceled')} className="px-3 py-1.5 rounded-lg border border-red-200 text-[12px] text-red-600 ml-auto">Отменить</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Сводка по бригадам за месяц */}
        {crewMonth.size > 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Бригады · закрыто в этом месяце</p>
            {[...crewMonth.entries()].sort((a, b) => b[1] - a[1]).map(([cid, sum]) => (
              <div key={cid} className="flex justify-between text-[13px] py-0.5">
                <span className="text-[#111110]">👷 {crewName(cid)}</span>
                <span className="font-mono font-semibold text-[#111110]">{RUB(sum)} ₽</span>
              </div>
            ))}
          </div>
        )}

        {/* Бригады */}
        <details className="bg-white rounded-xl border border-[#e4e4e0] p-4" open={crewsOpen} onToggle={e => setCrewsOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] cursor-pointer select-none">Бригады · {crews.filter(c => c.active).length}</summary>
          <div className="mt-2 space-y-1.5">
            {crews.map(c => (
              <div key={c.id} className="flex items-center justify-between text-[13px]">
                <span className={c.active ? 'text-[#111110]' : 'text-[#c4c4be] line-through'}>👷 {c.name}</span>
                <button onClick={async () => { await sb.from('installation_crews').update({ active: !c.active }).eq('id', c.id); load() }}
                  className="text-[11px] text-[#9a9a95] hover:text-[#111110]">{c.active ? 'скрыть' : 'вернуть'}</button>
              </div>
            ))}
            <div className="flex gap-1.5 pt-1">
              <input value={newCrew} onChange={e => setNewCrew(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCrew() }}
                placeholder="Женя, Арген" className="flex-1 border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] bg-white outline-none focus:border-[#111110]" />
              <button onClick={addCrew} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-medium">＋ Бригада</button>
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}
