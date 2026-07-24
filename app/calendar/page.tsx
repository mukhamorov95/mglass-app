'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'

type AppointmentType = 'measurement' | 'installation'
type AppointmentStatus = 'planned' | 'done' | 'cancelled'

type Appointment = {
  id:            string
  type:          AppointmentType
  scheduled_at:  string
  address:       string | null
  assignee_name: string | null
  notes:         string | null
  status:        AppointmentStatus
  order_id:      string | null
  client_name:   string | null
  orders:        { number: string; client_name: string } | null
}

// Монтажи из таблицы installations (богатая форма /installations) — вторая
// линия событий календаря рядом с appointments. Читаем напрямую браузерным
// клиентом (permissive RLS), как это делает сама страница /installations.
type InstRow = {
  id:             number
  order_no:       string
  title:          string | null
  client_name:    string | null
  address:        string | null
  scheduled_date: string | null
  time_from:      string | null
  time_to:        string | null
  crew_id:        number | null
  status:         'planned' | 'done' | 'canceled'
}

// Единое событие календаря: и замер/монтаж из appointments, и монтаж из installations
type CalEvent = {
  key:     string
  kind:    AppointmentType
  source:  'appointment' | 'installation'
  at:      Date
  status:  AppointmentStatus
  title:   string
  address: string | null
  sub:     string | null
  apptId?: string
}

const TYPE_LABELS: Record<AppointmentType, string> = {
  measurement:  'Замер',
  installation: 'Монтаж',
}

const TYPE_COLORS: Record<AppointmentType, string> = {
  measurement:  'bg-blue-100 text-blue-700 border-blue-200',
  installation: 'bg-amber-100 text-amber-700 border-amber-200',
}

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  planned:   'bg-white border-[#e4e4e0]',
  done:      'bg-emerald-50 border-emerald-200 opacity-70',
  cancelled: 'bg-gray-50 border-gray-200 opacity-50',
}

function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function getMonday(d: Date): Date {
  const copy = new Date(d)
  const day  = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

const WEEK_DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTH_NAMES = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь']

export default function CalendarPage() {
  const sb = createClient()
  const [monday, setMonday] = useState(() => getMonday(new Date()))
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [installs, setInstalls] = useState<InstRow[]>([])
  const [crews, setCrews] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>('')

  // New appointment form state
  const [newType, setNewType] = useState<AppointmentType>('measurement')
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('10:00')
  const [newAddress, setNewAddress] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const days = weekDays(monday)

  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { load().catch(() => setLoading(false)) }, [monday])

  async function load() {
    setLoading(true)
    const from = days[0].toISOString()
    const to   = new Date(days[6].getTime() + 86_400_000).toISOString()
    const fromDay = days[0].toISOString().slice(0, 10)
    const toDay   = days[6].toISOString().slice(0, 10)
    const [apptData, instQ, crewQ] = await Promise.all([
      fetch(`/api/appointments?from=${from}&to=${to}`).then(r => r.json()).catch(() => []),
      sb.from('installations')
        .select('id,order_no,title,client_name,address,scheduled_date,time_from,time_to,crew_id,status')
        .gte('scheduled_date', fromDay).lte('scheduled_date', toDay),
      sb.from('installation_crews').select('id,name'),
    ])
    setAppointments(Array.isArray(apptData) ? apptData : [])
    setInstalls((instQ.data ?? []) as InstRow[])
    setCrews((crewQ.data ?? []) as { id: number; name: string }[])
    setLoading(false)
  }

  function prevWeek() {
    const d = new Date(monday)
    d.setDate(d.getDate() - 7)
    setMonday(d)
  }

  function nextWeek() {
    const d = new Date(monday)
    d.setDate(d.getDate() + 7)
    setMonday(d)
  }

  function openForm(dateStr?: string) {
    setNewDate(dateStr ?? new Date().toISOString().slice(0, 10))
    setShowForm(true)
  }

  async function saveAppointment() {
    if (!newDate) return
    setSaving(true)
    const scheduled_at = `${newDate}T${newTime}:00`
    await fetch('/api/appointments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        type:          newType,
        scheduled_at,
        address:       newAddress,
        assignee_name: newAssignee,
        notes:         newNotes,
      }),
    })
    setSaving(false)
    setShowForm(false)
    setNewAddress(''); setNewAssignee(''); setNewNotes('')
    load()
  }

  async function updateStatus(id: string, status: AppointmentStatus) {
    await fetch('/api/appointments', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, status }),
    })
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a))
  }

  const today = new Date()
  const crewName = (id: number | null) => crews.find(c => c.id === id)?.name ?? null

  // Слияние двух источников в один список событий недели
  const events: CalEvent[] = [
    ...appointments.map(a => ({
      key:     'a' + a.id,
      kind:    a.type,
      source:  'appointment' as const,
      at:      new Date(a.scheduled_at),
      status:  a.status,
      title:   a.orders?.client_name || a.client_name || TYPE_LABELS[a.type],
      address: a.address,
      sub:     a.assignee_name,
      apptId:  a.id,
    })),
    ...installs.map(i => ({
      key:     'i' + i.id,
      kind:    'installation' as const,
      source:  'installation' as const,
      at:      new Date(`${i.scheduled_date ?? ''}T${i.time_from || '10:00'}:00`),
      status:  (i.status === 'canceled' ? 'cancelled' : i.status) as AppointmentStatus,
      title:   i.client_name || `#${i.order_no}`,
      address: i.address,
      sub:     [[i.time_from, i.time_to].filter(Boolean).join('–'), crewName(i.crew_id)].filter(Boolean).join(' · ') || null,
    })),
  ]
  const plannedEvents = events.filter(e => e.status === 'planned')

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1100px] mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[22px] font-bold text-[#111110]">Календарь</h1>
            <p className="text-[13px] text-[#9a9a95]">Замеры и монтажи</p>
          </div>
          <button
            onClick={() => openForm()}
            className="px-4 py-2 bg-[#111110] text-white text-[13px] font-semibold rounded-xl hover:bg-[#2a2a28] transition-colors"
          >
            + Добавить
          </button>
        </div>

        {/* Week navigation */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] mb-4">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0f0ec]">
            <button onClick={prevWeek} className="p-1.5 hover:bg-[#f8f8f7] rounded-lg transition-colors">
              <svg className="w-5 h-5 text-[#6b6b66]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <p className="text-[14px] font-semibold text-[#111110]">
              {days[0].getDate()} — {days[6].getDate()} {MONTH_NAMES[days[6].getMonth()]} {days[6].getFullYear()}
            </p>
            <button onClick={nextWeek} className="p-1.5 hover:bg-[#f8f8f7] rounded-lg transition-colors">
              <svg className="w-5 h-5 text-[#6b6b66]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Day columns */}
          <div className="grid grid-cols-7">
            {days.map((day, i) => {
              const isToday  = isSameDay(day, today)
              const dayAppts = events
                .filter(e => isSameDay(e.at, day))
                .sort((a, b) => a.at.getTime() - b.at.getTime())
              const dateStr  = day.toISOString().slice(0, 10)

              return (
                <div key={i} className={`border-r border-[#f0f0ec] last:border-r-0 min-h-[120px] ${isToday ? 'bg-blue-50/30' : ''}`}>
                  {/* Day header */}
                  <div className={`px-2 py-2 border-b border-[#f0f0ec] ${isToday ? 'bg-blue-600' : ''}`}>
                    <p className={`text-[11px] font-bold uppercase ${isToday ? 'text-white' : 'text-[#9a9a95]'}`}>
                      {WEEK_DAY_LABELS[i]}
                    </p>
                    <p className={`text-[16px] font-bold ${isToday ? 'text-white' : 'text-[#111110]'}`}>
                      {day.getDate()}
                    </p>
                  </div>

                  {/* Events */}
                  <div className="p-1 space-y-1">
                    {loading ? null : dayAppts.map(a => (
                      <div key={a.key}
                        className={`rounded-lg border px-2 py-1.5 ${STATUS_COLORS[a.status]}`}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${TYPE_COLORS[a.kind]}`}>
                            {a.source === 'installation' ? '🔧 ' : ''}{TYPE_LABELS[a.kind]}
                          </span>
                          <span className="text-[10px] text-[#9a9a95]">
                            {a.at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-[11px] font-semibold text-[#111110] truncate">{a.title}</p>
                        {a.sub && (
                          <p className="text-[10px] text-[#9a9a95] truncate">{a.sub}</p>
                        )}
                        {a.source === 'installation' ? (
                          <Link href="/installations" className="mt-1 inline-block text-[10px] text-amber-700 hover:text-amber-900">
                            → монтажи
                          </Link>
                        ) : a.status === 'planned' && a.apptId ? (
                          <button
                            onClick={() => updateStatus(a.apptId!, 'done')}
                            className="mt-1 text-[10px] text-emerald-600 hover:text-emerald-800"
                          >
                            ✓ Выполнено
                          </button>
                        ) : null}
                      </div>
                    ))}

                    <button
                      onClick={() => openForm(dateStr)}
                      className="w-full text-center py-1 text-[11px] text-[#c4c4be] hover:text-[#6b6b66] transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Upcoming list — замеры + монтажи из обоих источников */}
        {plannedEvents.length > 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
            <div className="px-5 py-3 bg-[#f8f8f7] border-b border-[#e4e4e0]">
              <p className="text-[12px] font-bold text-[#9a9a95] uppercase tracking-wider">
                Предстоящие ({plannedEvents.length})
              </p>
            </div>
            <div className="divide-y divide-[#f0f0ec]">
              {plannedEvents
                .sort((a, b) => a.at.getTime() - b.at.getTime())
                .map(a => (
                  <div key={a.key} className="px-5 py-3.5 flex items-start gap-4">
                    <div className="text-center flex-shrink-0 w-12">
                      <p className="text-[18px] font-bold text-[#111110]">
                        {a.at.getDate()}
                      </p>
                      <p className="text-[10px] text-[#9a9a95] uppercase">
                        {MONTH_NAMES[a.at.getMonth()].slice(0, 3)}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${TYPE_COLORS[a.kind]}`}>
                          {a.source === 'installation' ? '🔧 ' : ''}{TYPE_LABELS[a.kind]}
                        </span>
                        <span className="text-[12px] text-[#9a9a95]">
                          {a.at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-[13px] font-semibold text-[#111110]">{a.title}</p>
                      {a.address && <p className="text-[12px] text-[#9a9a95]">{a.address}</p>}
                      {a.sub && <p className="text-[11px] text-[#b4b4b0]">{a.sub}</p>}
                    </div>
                    {a.source === 'installation' ? (
                      <Link href="/installations" className="text-[12px] text-amber-700 hover:text-amber-900 flex-shrink-0">
                        → монтажи
                      </Link>
                    ) : a.apptId ? (
                      <button
                        onClick={() => updateStatus(a.apptId!, 'done')}
                        className="text-[12px] text-emerald-600 hover:text-emerald-800 flex-shrink-0"
                      >
                        Выполнено ✓
                      </button>
                    ) : null}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* New appointment modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#e4e4e0] w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-bold text-[#111110]">Новая запись</h2>
              <button onClick={() => setShowForm(false)} className="text-[#9a9a95] hover:text-[#6b6b66]">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(['measurement', 'installation'] as AppointmentType[]).map(t => (
                <button key={t} onClick={() => setNewType(t)}
                  className={`py-2.5 rounded-xl text-[13px] font-semibold border transition-colors ${
                    newType === t ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0]'
                  }`}>
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-[#9a9a95] mb-1">Дата</label>
                <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                  className="w-full border border-[#e4e4e0] rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-[#0071e3]" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#9a9a95] mb-1">Время</label>
                <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)}
                  className="w-full border border-[#e4e4e0] rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-[#0071e3]" />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#9a9a95] mb-1">Адрес</label>
              <input type="text" value={newAddress} onChange={e => setNewAddress(e.target.value)}
                placeholder="ул. Примерная, 1"
                className="w-full border border-[#e4e4e0] rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-[#0071e3]" />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#9a9a95] mb-1">Ответственный</label>
              <input type="text" value={newAssignee} onChange={e => setNewAssignee(e.target.value)}
                placeholder="Имя замерщика / монтажника"
                className="w-full border border-[#e4e4e0] rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-[#0071e3]" />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#9a9a95] mb-1">Заметки</label>
              <textarea rows={2} value={newNotes} onChange={e => setNewNotes(e.target.value)}
                className="w-full border border-[#e4e4e0] rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-[#0071e3] resize-none" />
            </div>

            <div className="flex gap-2">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 border border-[#e4e4e0] rounded-xl text-[13px] text-[#6b6b66] hover:bg-[#f8f8f7]">
                Отмена
              </button>
              <button onClick={saveAppointment} disabled={saving || !newDate}
                className="flex-1 py-2.5 bg-[#111110] text-white rounded-xl text-[13px] font-semibold disabled:opacity-40">
                {saving ? 'Сохраняю...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
