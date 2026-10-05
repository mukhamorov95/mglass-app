'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { B2B_SOURCES, sourceLabel } from '@/lib/types'
import {
  INQUIRY_STATUSES, ANSWER_SLA_MIN, inquiryTitle, minutesBetween, durationLabel, isOverdue,
  type Inquiry, type InquiryStatus,
} from '@/lib/b2b/inquiries'
import { loadJson, sendOrToast, toast } from '@/lib/toast'

// Учёт входящих заявок. Переписка — в чате Авито; здесь кто, что хочет, статус и как быстро
// ответили. Новая заявка без ответа дольше 30 минут подсвечена: от этого зависит уровень
// сервиса на Авито.

type Filter = 'open' | 'all' | 'won' | 'lost'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'В работе' },
  { id: 'won', label: 'Заказы' },
  { id: 'lost', label: 'Отказы' },
  { id: 'all', label: 'Все' },
]

const EMPTY_FORM = { source: 'avito', contact_name: '', company: '', phone: '', chat_url: '', listing: '', request: '' }
const input = 'w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]'
const label = 'block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1'

const statusMeta = (s: string) => INQUIRY_STATUSES.find(x => x.value === s) ?? INQUIRY_STATUSES[0]

export default function InquiriesClient() {
  const [filter, setFilter] = useState<Filter>('open')
  const [rows, setRows] = useState<Inquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [lostFor, setLostFor] = useState<number | null>(null)
  const [lostReason, setLostReason] = useState('')
  const [now, setNow] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const r = await loadJson<{ inquiries: Inquiry[] }>(`/api/b2b/inquiries?status=${filter}`)
    setRows(r.data?.inquiries ?? [])
    setError(r.error)
    setNow(new Date().toISOString())
    setLoading(false)
  }, [filter])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  // Возраст новых заявок тикает раз в минуту, без перезагрузки списка.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 60_000)
    return () => clearInterval(t)
  }, [])

  async function create() {
    setSaving(true)
    const r = await sendOrToast('Заявка не сохранена', '/api/b2b/inquiries', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    setSaving(false)
    if (!r) return
    toast.success('Заявка добавлена')
    setForm(EMPTY_FORM)
    setShowForm(false)
    if (filter !== 'open' && filter !== 'all') setFilter('open')
    else load()
  }

  async function patch(id: number, body: Record<string, unknown>, ok: string) {
    setBusy(id)
    const r = await sendOrToast('Не получилось', '/api/b2b/inquiries', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }),
    })
    setBusy(null)
    if (!r) return null
    const j = await r.json().catch(() => null) as { inquiry?: Inquiry; clientId?: number; linked?: boolean } | null
    if (j?.inquiry) setRows(prev => prev.map(x => x.id === id ? j.inquiry! : x))
    toast.success(ok)
    return j
  }

  const setStatus = (i: Inquiry, s: InquiryStatus, reason?: string) =>
    patch(i.id, { action: 'status', status: s, lost_reason: reason ?? null }, `${inquiryTitle(i)}: ${statusMeta(s).label.toLowerCase()}`)

  async function convert(i: Inquiry) {
    const j = await patch(i.id, { action: 'convert' }, 'Карточка клиента готова')
    if (j?.linked) toast.info('Клиент с таким названием уже был — заявка привязана к нему')
  }

  const newCount = rows.filter(r => r.status === 'new').length
  const overdue = now ? rows.filter(r => isOverdue(r, now)).length : 0

  return (
    <div className="min-h-screen bg-[#f5f5f3]">
      <div className="max-w-[900px] mx-auto px-4 py-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-[16px] font-semibold text-[#111110] tracking-tight">Входящие заявки</h1>
            <p className="text-[12px] text-[#8a8a85] mt-0.5">
              Авито и другие каналы. Переписка — в чате Авито, первый ответ — за {ANSWER_SLA_MIN} минут.
              {newCount > 0 && <span className="ml-1.5 font-semibold text-[#111110]">Без ответа: {newCount}.</span>}
              {overdue > 0 && <span className="ml-1.5 font-semibold text-red-600">Дольше {ANSWER_SLA_MIN} мин: {overdue}.</span>}
            </p>
          </div>
          <button onClick={() => setShowForm(s => !s)}
            className="shrink-0 text-[12px] font-semibold text-white bg-[#111110] px-3 py-1.5 rounded-lg hover:bg-[#2a2a28]">
            {showForm ? 'Скрыть' : '+ Заявка'}
          </button>
        </div>

        <NotifyPanel />

        {showForm && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 mb-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Откуда</label>
              <select className={input} value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                {B2B_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Ссылка на чат</label>
              <input className={input} placeholder="https://www.avito.ru/profile/messenger/…" value={form.chat_url}
                onChange={e => setForm(f => ({ ...f, chat_url: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Кто</label>
              <input className={input} placeholder="Имя на Авито" value={form.contact_name}
                onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Компания</label>
              <input className={input} placeholder="если назвали" value={form.company}
                onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Телефон</label>
              <input className={input} inputMode="tel" placeholder="если дали" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Объявление</label>
              <input className={input} placeholder="Зеркало на заказ по вашим размерам" value={form.listing}
                onChange={e => setForm(f => ({ ...f, listing: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Что хочет</label>
              <textarea rows={3} className={`${input} resize-y`} placeholder="Размеры, толщина, количество, срок" value={form.request}
                onChange={e => setForm(f => ({ ...f, request: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button onClick={create}
                disabled={saving || !(form.contact_name.trim() || form.company.trim() || form.phone.trim() || form.chat_url.trim())}
                className="text-[13px] font-semibold text-white bg-[#111110] px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">
                {saving ? 'Сохраняю…' : 'Сохранить заявку'}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-1.5 mb-3 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`text-[12px] px-3 py-1 rounded-full border ${filter === f.id ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:text-[#111110]'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl px-4 py-3 mb-3">{error}</div>}
        {loading ? (
          <div className="text-[13px] text-[#9a9a95] px-1 py-6">Загружаю…</div>
        ) : rows.length === 0 && !error ? (
          <div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-6 text-[13px] text-[#6b6b66]">
            {filter === 'open' ? 'Заявок в работе нет. Новый чат на Авито — «+ Заявка», 20 секунд.' : 'Здесь пока пусто.'}
          </div>
        ) : (
          <div className="grid gap-2">
            {rows.map(i => {
              const st = statusMeta(i.status)
              const late = now ? isOverdue(i, now) : false
              const age = now ? durationLabel(minutesBetween(i.created_at, now)) : ''
              return (
                <div key={i.id} className={`bg-white border rounded-xl px-4 py-3 ${late ? 'border-red-300' : 'border-[#e4e4e0]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                        <span className="text-[14px] font-semibold text-[#111110]">{inquiryTitle(i)}</span>
                        {i.company && i.contact_name && <span className="text-[12px] text-[#6b6b66]">{i.contact_name}</span>}
                      </div>
                      <p className="text-[11px] text-[#8a8a85] mt-1">
                        {sourceLabel(i.source)}{i.listing ? ` · ${i.listing}` : ''}
                        {i.status === 'new'
                          ? <span className={late ? 'text-red-600 font-semibold' : ''}> · ждёт ответа {age}</span>
                          : i.answered_at && <span> · ответ за {durationLabel(minutesBetween(i.created_at, i.answered_at))}</span>}
                        {i.status === 'lost' && i.lost_reason && <span> · {i.lost_reason}</span>}
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {i.chat_url && (
                        <a href={i.chat_url} target="_blank" rel="noopener noreferrer"
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#111110] hover:bg-[#f8f8f7]">Чат</a>
                      )}
                      {i.phone && (
                        <a href={`tel:${i.phone.replace(/[^\d+]/g, '')}`}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#111110] hover:bg-[#f8f8f7]">Звонок</a>
                      )}
                    </div>
                  </div>
                  {i.request && <p className="text-[13px] text-[#111110] mt-2 whitespace-pre-line line-clamp-4">{i.request}</p>}

                  <div className="flex gap-1.5 mt-3 flex-wrap items-center">
                    {i.status === 'new' && <Act onClick={() => setStatus(i, 'answered')} disabled={busy === i.id} dark>Ответил</Act>}
                    {(i.status === 'new' || i.status === 'answered') && <Act onClick={() => setStatus(i, 'quoted')} disabled={busy === i.id}>Посчитал</Act>}
                    {i.status !== 'won' && i.status !== 'lost' && <Act onClick={() => setStatus(i, 'won')} disabled={busy === i.id}>Заказ</Act>}
                    {i.status !== 'won' && i.status !== 'lost' && lostFor !== i.id && <Act onClick={() => { setLostFor(i.id); setLostReason('') }} disabled={busy === i.id}>Отказ</Act>}
                    {(i.status === 'won' || i.status === 'lost') && <Act onClick={() => setStatus(i, 'answered')} disabled={busy === i.id}>Вернуть в работу</Act>}
                    <span className="flex-1" />
                    {i.b2b_client_id ? (
                      <>
                        <Link href={`/calculator/b2b?clientId=${i.b2b_client_id}`} className="text-[11px] font-semibold text-blue-600 hover:underline">Расчёт →</Link>
                        <Link href={`/b2b-crm/${i.b2b_client_id}`} className="text-[11px] font-semibold text-blue-600 hover:underline">Карточка клиента →</Link>
                      </>
                    ) : (
                      <Act onClick={() => convert(i)} disabled={busy === i.id}>Создать клиента</Act>
                    )}
                  </div>

                  {lostFor === i.id && (
                    <div className="flex gap-1.5 mt-2">
                      <input autoFocus className={input} placeholder="Почему отказ: дорого, срок, не наш профиль…" value={lostReason}
                        onChange={e => setLostReason(e.target.value)} />
                      <Act onClick={async () => { await setStatus(i, 'lost', lostReason); setLostFor(null) }} disabled={busy === i.id} dark>Отказ</Act>
                      <Act onClick={() => setLostFor(null)}>Отмена</Act>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Act({ children, onClick, disabled, dark }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; dark?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap disabled:opacity-40 ${dark ? 'bg-[#111110] text-white hover:bg-[#2a2a28]' : 'border border-[#e4e4e0] text-[#111110] hover:bg-[#f8f8f7]'}`}>
      {children}
    </button>
  )
}

type Person = { id: string; name: string; role: string; telegram: boolean; on: boolean }

// Кому уходят уведомления о новых заявках. Видит только владелец: у остальных API отвечает 403,
// и блок не рисуется.
function NotifyPanel() {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/b2b/inquiries/notify').then(r => r.ok ? r.json() : null).then(j => {
      if (alive && j?.people) setPeople(j.people as Person[])
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!people) return null
  const on = people.filter(p => p.on)

  async function toggle(p: Person) {
    setBusy(p.id)
    const r = await sendOrToast('Не сохранено', '/api/b2b/inquiries/notify', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: p.id, on: !p.on }),
    })
    if (r) setPeople(ps => ps?.map(x => x.id === p.id ? { ...x, on: !p.on } : x) ?? null)
    setBusy(null)
  }

  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 mb-4">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="text-[12px] text-[#111110]">
          <span className="font-semibold">Уведомления в Telegram:</span>{' '}
          {on.length ? on.map(p => p.name).join(', ') : <span className="text-red-600">никому</span>}
        </span>
        <span className="text-[11px] font-semibold text-blue-600 shrink-0">{open ? 'Свернуть' : 'Изменить'}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-1.5">
          {people.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-[13px] text-[#111110]">
              <input type="checkbox" checked={p.on} disabled={busy === p.id} onChange={() => toggle(p)} />
              <span>{p.name}</span>
              <span className="text-[11px] text-[#9a9a95]">{p.role}</span>
              {!p.telegram && <span className="text-[11px] text-amber-600">бот не привязан — не получит</span>}
            </label>
          ))}
          <p className="text-[11px] text-[#9a9a95] mt-1">
            Получатель видит телефон и запрос клиента. Если отмечен ровно один сотрудник (не владелец), заявки из чатов Авито назначаются ему.
          </p>
        </div>
      )}
    </div>
  )
}
