'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  COUNT_KEYS, emptyDay, fmtMinuteOfDay, fmtTime, median, mskDay,
  type AmoActivityReport, type DayActivity, type ManagerActivity,
} from '@/lib/amoActivity'
import { checkDay, checkPeriod, fmtHm, saturdayDuty, type ManagerSchedule } from '@/lib/managerSchedule'
import { sameName, type WazzupAuthors } from '@/lib/wazzupOutgoing'
import { Card, Num, fmtWait, isWeekend, nowTs, shortDay, weekday } from './ui'
import ResultsBlock from './ResultsBlock'
import PbxBlock from './PbxBlock'
import SchedulesBlock from './SchedulesBlock'
import CoachingPreview from './CoachingPreview'
import ActionTimeline from './ActionTimeline'

// Рабочий день менеджеров по AmoCRM. Команда общается с клиентами только через amo,
// поэтому след в amo — это и есть рабочий день. Ноль здесь — повод спросить, а не
// приговор: отпуск, больничный и работа мимо amo выглядят одинаково. Поэтому рядом —
// норма (график), результат (сделки) и то, чего amo не видит (АТС, авторы Wazzup).

type Preset = 'today' | 'yesterday' | 'week' | 'two' | 'day'
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Сегодня' }, { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: '7 дней' }, { key: 'two', label: '14 дней' }, { key: 'day', label: 'День' },
]
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7) // 07:00–22:59

type ActivityResponse = AmoActivityReport & { wazzup?: (WazzupAuthors & { since: string | null }) | { error: string } }

function range(preset: Preset, day: string) {
  const t = nowTs()
  if (preset === 'today') return { from: mskDay(t), to: mskDay(t) }
  if (preset === 'yesterday') return { from: mskDay(t - 86400), to: mskDay(t - 86400) }
  if (preset === 'week') return { from: mskDay(t - 6 * 86400), to: mskDay(t) }
  if (preset === 'two') return { from: mskDay(t - 13 * 86400), to: mskDay(t) }
  return { from: day, to: day }
}

function cellColor(own: number, noAuthor: number) {
  if (own >= 15) return 'bg-[#1f6f43]'
  if (own >= 6) return 'bg-[#3f9a66]'
  if (own >= 1) return 'bg-[#a6d4b5]'
  if (noAuthor >= 1) return 'bg-[#cfdcf0]'
  return 'bg-[#f0f0ec]'
}

function HourStrip({ d, off }: { d: DayActivity; off: boolean }) {
  return (
    <div className={`flex gap-px ${off ? 'opacity-40' : ''}`}>
      {HOURS.map(h => (
        <div key={h} title={`${String(h).padStart(2, '0')}:00 — действий ${d.hourly[h]}, сообщений с телефона ${d.hourlyNoAuthor[h]}`}
          className={`h-4 flex-1 min-w-[10px] rounded-[2px] ${cellColor(d.hourly[h], d.hourlyNoAuthor[h])}`} />
      ))}
    </div>
  )
}

function DayNorm({ d, s }: { d: DayActivity; s?: ManagerSchedule }) {
  const c = checkDay(d, s, nowTs())
  if (c.notStarted) return <span className="text-[#9a9a95]">ещё не работал(а)</span>
  if (!c.expected) {
    if (s && d.firstAt !== null && new Date(`${d.day}T12:00:00Z`).getUTCDay() === 6) return <span className="text-[#111110]">дежурство</span>
    return <span className="text-[#9a9a95]">{s ? 'выходной' : '—'}</span>
  }
  if (c.absent) return <span className="text-red-600">нет в amo весь день</span>
  // первое действие в amo — не приход: подписываем тем, что измерено
  const parts = [
    c.lateMin !== null && `начал(а) в amo на ${fmtWait(c.lateMin)} позже`,
    c.earlyMin !== null && `закончил(а) на ${fmtWait(c.earlyMin)} раньше`,
  ].filter(Boolean)
  return parts.length ? <span className="text-amber-700">{parts.join(', ')}</span> : <span className="text-green-700">в рамках графика</span>
}

function PeriodNorm({ m, s }: { m: ManagerActivity; s?: ManagerSchedule }) {
  if (!s) return <span className="text-[#9a9a95]">нет графика</span>
  const p = checkPeriod(m.days, s, nowTs())
  if (p.expectedDays === 0) return <span className="text-[#9a9a95]">{s.starts_on ? `с ${shortDay(s.starts_on)}` : 'нет рабочих дней'}</span>
  const bad = p.absentDays.length + p.lateDays + p.earlyDays
  return (
    <span className={bad ? 'text-amber-700' : 'text-green-700'} title={p.absentDays.length ? `Пропуски: ${p.absentDays.map(shortDay).join(', ')}` : undefined}>
      {bad ? `поздний старт ${p.lateDays} · ранний финиш ${p.earlyDays} · пустых ${p.absentDays.length}` : 'в рамках графика'}
      <span className="text-[#9a9a95]"> из {p.expectedDays} дн.</span>
    </span>
  )
}

function DayRows({ m, s, onDay }: { m: ManagerActivity; s?: ManagerSchedule; onDay: (day: string) => void }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="text-[#9a9a95] text-left">
          <th className="py-1 pr-3 font-normal">День</th>
          <th className="py-1 pr-3 font-normal">Начало–конец</th>
          <th className="py-1 pr-3 font-normal">По графику</th>
          <th className="py-1 pr-3 font-normal text-right">Часов</th>
          <th className="py-1 pr-3 font-normal text-right">Макс. пауза</th>
          <th className="py-1 pr-3 font-normal text-right">Действий</th>
          <th className="py-1 pr-3 font-normal text-right">Сообщений</th>
          <th className="py-1 pr-3 font-normal text-right">Пишут клиенты</th>
          <th className="py-1 pr-3 font-normal text-right">Ответ</th>
          <th className="py-1 pr-3 font-normal text-right">Задачи</th>
          <th className="py-1 pr-3 font-normal text-right">Исх. звонки</th>
          <th className="py-1 font-normal text-right">Входящие</th>
        </tr>
      </thead>
      <tbody>
        {m.days.map(d => (
          <tr key={d.day} className={`border-t border-[#f0f0ec] ${isWeekend(d.day) ? 'text-[#9a9a95]' : ''}`}>
            <td className="py-1 pr-3">{shortDay(d.day)} {weekday(d.day)}</td>
            <td className="py-1 pr-3">{d.firstAt === null ? <span className="text-[#9a9a95]">нет действий</span> : `${fmtTime(d.firstAt)}–${fmtTime(d.lastAt)}`}</td>
            <td className="py-1 pr-3"><DayNorm d={d} s={s} /></td>
            <td className="py-1 pr-3 text-right"><Num v={d.activeHours} /></td>
            <td className="py-1 pr-3 text-right"><Num v={d.firstAt === null ? '—' : fmtWait(d.longestPauseMin)} muted /></td>
            <td className="py-1 pr-3 text-right">
              {d.actions > 0
                ? <button onClick={() => onDay(d.day)} className="underline decoration-dotted decoration-[#9a9a95] hover:text-[#111110]"><Num v={d.actions} /></button>
                : <Num v={d.actions} />}
            </td>
            <td className="py-1 pr-3 text-right"><Num v={d.messagesOwn} /> <span className="text-[#9a9a95]">+{d.messagesNoAuthor}</span></td>
            <td className="py-1 pr-3 text-right"><Num v={d.clientMessages} muted /></td>
            <td className="py-1 pr-3 text-right"><Num v={fmtWait(median(d.replyMinutes))} /></td>
            <td className="py-1 pr-3 text-right"><Num v={d.tasksCompleted} /> <span className="text-[#9a9a95]">/ {d.tasksPostponed}</span></td>
            <td className="py-1 pr-3 text-right"><Num v={d.callsOutConnected} /> <span className="text-[#9a9a95]">/ {d.callsOut}</span></td>
            <td className="py-1 text-right"><Num v={d.callsInAnswered} /> <span className={d.callsInMissed ? 'text-red-600' : 'text-[#9a9a95]'}>/ {d.callsInMissed}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Человек с графиком и без единого действия в amo иначе просто пропал бы из таблицы
function absentee(s: ManagerSchedule, days: string[]): ManagerActivity {
  return {
    userId: s.amo_user_id, name: s.name, days: days.map(emptyDay),
    total: Object.fromEntries(COUNT_KEYS.map(k => [k, 0])) as ManagerActivity['total'],
    workDays: 0, medianStartMin: null, medianEndMin: null, avgActiveHours: 0, medianReplyMin: null, repliesCounted: 0,
  }
}

function WazzupBlock({ w, managers }: { w: ActivityResponse['wazzup']; managers: ManagerActivity[] }) {
  if (!w) return null
  if ('error' in w) return <Card title="Кто писал из Wazzup"><p className="text-[13px] text-red-700">{w.error}</p></Card>
  const hint = w.since
    ? `Исходящие, отправленные из приложения Wazzup или с телефона, с автором по данным Wazzup. Копятся с ${shortDay(mskDay(Math.floor(Date.parse(w.since) / 1000)))}.`
    : 'Исходящие Wazzup с автором начали сохраняться 22.09 — данные появятся после первых сообщений.'
  return (
    <Card title="Кто писал из Wazzup" hint={hint}>
      {w.total === 0 ? <p className="text-[13px] text-[#9a9a95]">За период исходящих из Wazzup нет.</p> : (
        <table className="w-full text-[13px]">
          <tbody>
            {w.authors.map(a => {
              const m = managers.find(x => sameName(x.name, a.name))
              return (
                <tr key={a.name} className="border-b border-[#f0f0ec]">
                  <td className="py-1.5 pr-2 text-[#111110]">{a.name}{m && m.name !== a.name && <span className="text-[#9a9a95]"> · в amo «{m.name}»</span>}</td>
                  <td className="py-1.5 px-2 text-right"><Num v={a.total} /> <span className="text-[#9a9a95]">сообщ.</span></td>
                  <td className="py-1.5 pl-2 text-right text-[#9a9a95]">{fmtTime(a.firstAt)}–{fmtTime(a.lastAt)}</td>
                </tr>
              )
            })}
            <tr>
              <td className="py-1.5 pr-2 text-[#9a9a95]">без автора (прямо с телефона)</td>
              <td className="py-1.5 px-2 text-right"><Num v={w.noAuthor} muted /></td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  )
}

export default function AmoActivityPage() {
  const [preset, setPreset] = useState<Preset>('today')
  const [day, setDay] = useState(() => mskDay(nowTs() - 86400))
  const [data, setData] = useState<ActivityResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<number | null>(null)
  // какое число «Действий» раскрыто в ленту: чей день смотрим
  const [tl, setTl] = useState<{ userId: number; day: string; name: string } | null>(null)
  const [schedules, setSchedules] = useState<ManagerSchedule[]>([])
  const [resultsOn, setResultsOn] = useState(false)

  useEffect(() => {
    let cancelled = false
    const r = range(preset, day)
    fetch(`/api/commercial/amo-activity?from=${r.from}&to=${r.to}`)
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Ошибка ${res.status}`)
        if (!cancelled) { setData(json as ActivityResponse); setError(null); setResultsOn(true) }
      })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setData(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [preset, day])

  const [schedulesError, setSchedulesError] = useState<string | null>(null)
  const loadSchedules = useCallback(() => {
    fetch('/api/commercial/manager-schedules')
      .then(async res => {
        const json = await res.json()
        if (!res.ok || !Array.isArray(json.schedules)) throw new Error(json.error ?? `Ошибка ${res.status}`)
        setSchedules(json.schedules as ManagerSchedule[])
        setSchedulesError(null)
      })
      .catch(e => setSchedulesError(`Графики не загрузились — колонка «По графику» пустая: ${e instanceof Error ? e.message : String(e)}`))
  }, [])
  useEffect(() => { loadSchedules() }, [loadSchedules])

  const choosePreset = (p: Preset) => { if (p !== preset) { setPreset(p); setLoading(true) } }
  const chooseDay = (v: string) => { if (v && v !== day) { setDay(v); setLoading(true) } }

  const scheduleOf = (id: number) => schedules.find(s => s.amo_user_id === id)
  // Не продавец (владелец, сопровождение, офис) не мерится воронкой B2C — он справочно, внизу
  const notSeller = (id: number) => scheduleOf(id)?.is_seller === false
  const active = (data?.managers ?? []).filter(m => m.total.actions > 0 || m.total.messagesNoAuthor > 0)
  const now = nowTs()
  const missing = data
    ? schedules
      .filter(s => !active.some(m => m.userId === s.amo_user_id))
      .map(s => absentee(s, data.days))
      .filter(m => checkPeriod(m.days, scheduleOf(m.userId), now).expectedDays > 0)
    : []
  const everyone = [...active, ...missing]
  const managers = everyone.filter(m => !notSeller(m.userId))
  const others = everyone.filter(m => notSeller(m.userId))
  const single = (data?.days.length ?? 0) === 1
  const firstStarter = single
    ? active.filter(m => m.days[0].firstAt !== null).sort((a, b) => a.days[0].firstAt! - b.days[0].firstAt!)[0]
    : undefined
  const r = range(preset, day)
  const names = new Map((data?.managers ?? []).map(m => [m.userId, m.name]))

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-4">
          <h1 className="text-[18px] font-semibold text-[#111110]">Рабочий день менеджеров</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">
            По действиям в AmoCRM, московское время: кто во сколько начал и закончил — против графика, что из этого вышло в сделках и что amo не видит.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="flex gap-1 bg-white border border-[#e4e4e0] rounded-lg p-1">
            {PRESETS.map(p => (
              <button key={p.key} onClick={() => choosePreset(p.key)}
                className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${preset === p.key ? 'bg-[#111110] text-white' : 'text-[#6b6b66] hover:bg-[#f5f5f3]'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'day' && (
            <input type="date" value={day} max={mskDay(nowTs())} onChange={e => chooseDay(e.target.value)}
              className="bg-white border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] text-[#111110]" />
          )}
          {data && !loading && (
            <span className="text-[12px] text-[#9a9a95]">
              {single ? `${shortDay(data.days[0])} ${weekday(data.days[0])}` : `${shortDay(data.days[0])} — ${shortDay(data.days[data.days.length - 1])}, дней: ${data.days.length}`}
            </span>
          )}
        </div>

        {loading && <div className="bg-white border border-[#e4e4e0] rounded-xl p-6 text-[13px] text-[#9a9a95] mb-4">Загружаю из AmoCRM… за 14 дней это до минуты.</div>}
        {error && <div className="bg-white border border-red-200 rounded-xl p-4 text-[13px] text-red-700 mb-4">{error}</div>}
        {schedulesError && <div className="bg-white border border-amber-200 rounded-xl p-3 text-[12px] text-amber-800 mb-4">{schedulesError}</div>}

        {data && !loading && (
          <>
            {firstStarter && (
              <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 mb-4 text-[13px] text-[#111110]">
                Первым начал: <b>{firstStarter.name}</b> в {fmtTime(firstStarter.days[0].firstAt)}
                {managers.filter(m => m.days[0].firstAt === null).length > 0 && (
                  <span className="text-[#9a9a95]"> · без действий: {managers.filter(m => m.days[0].firstAt === null).map(m => m.name).join(', ')}</span>
                )}
              </div>
            )}

            <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto mb-4">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] text-[#9a9a95] text-left border-b border-[#e4e4e0]">
                    <th className="px-4 py-2 font-normal">Менеджер</th>
                    {!single && <th className="px-2 py-2 font-normal text-right">Дней</th>}
                    <th className="px-2 py-2 font-normal text-right">{single ? 'Начало' : 'Начало (медиана)'}</th>
                    <th className="px-2 py-2 font-normal text-right">{single ? 'Конец' : 'Конец (медиана)'}</th>
                    <th className="px-2 py-2 font-normal" title="Сравнение с графиком из блока «Графики» ниже">По графику</th>
                    <th className="px-2 py-2 font-normal text-right" title="Сколько разных часов было хотя бы одно действие">Часов с действиями</th>
                    <th className="px-2 py-2 font-normal text-right">Действий</th>
                    <th className="px-2 py-2 font-normal text-right" title="Из amo под своим именем + без автора (с телефона / из Wazzup) в его сделках">Сообщений</th>
                    <th className="px-2 py-2 font-normal text-right" title="Входящие сообщения клиентов в его сделках">Пишут клиенты</th>
                    <th className="px-2 py-2 font-normal text-right" title="Медиана ожидания ответа на сообщения, пришедшие с 9 до 19">Ответ клиенту</th>
                    <th className="px-2 py-2 font-normal text-right" title="Последнее слово за клиентом — ответа не было до конца периода">Без ответа</th>
                    <th className="px-2 py-2 font-normal text-right" title="Закрыто / перенесено сроков">Задачи</th>
                    <th className="px-2 py-2 font-normal text-right" title="Дозвонился / всего исходящих">Исх. звонки</th>
                    <th className="px-2 py-2 font-normal text-right" title="Принято / пропущено">Входящие</th>
                    <th className="px-4 py-2 font-normal text-right">Карточек</th>
                  </tr>
                </thead>
                <tbody>
                  {managers.concat().map(m => {
                    const d0 = m.days[0]
                    const s = scheduleOf(m.userId)
                    return (
                      <Fragment key={m.userId}>
                        <tr onClick={() => setOpen(open === m.userId ? null : m.userId)}
                          className="border-b border-[#f0f0ec] hover:bg-[#fafaf8] cursor-pointer">
                          <td className="px-4 py-2 font-medium text-[#111110] whitespace-nowrap">
                            {open === m.userId ? '▾' : '▸'} {m.name}
                            {s && (s.work_from || s.work_to) && <span className="text-[11px] font-normal text-[#9a9a95]"> {fmtHm(s.work_from)}–{fmtHm(s.work_to)}</span>}
                          </td>
                          {!single && <td className="px-2 py-2 text-right"><Num v={`${m.workDays} из ${data.days.length}`} /></td>}
                          <td className="px-2 py-2 text-right"><Num v={single ? fmtTime(d0.firstAt) : fmtMinuteOfDay(m.medianStartMin)} /></td>
                          <td className="px-2 py-2 text-right"><Num v={single ? fmtTime(d0.lastAt) : fmtMinuteOfDay(m.medianEndMin)} /></td>
                          <td className="px-2 py-2 text-[12px] whitespace-nowrap">{single ? <DayNorm d={d0} s={s} /> : <PeriodNorm m={m} s={s} />}</td>
                          <td className="px-2 py-2 text-right"><Num v={single ? d0.activeHours : m.avgActiveHours} /></td>
                          <td className="px-2 py-2 text-right">
                            {m.total.actions > 0 && single
                              ? <button
                                title="Показать, что именно делал"
                                onClick={e => { e.stopPropagation(); setOpen(m.userId); setTl({ userId: m.userId, day: data.days[0], name: m.name }) }}
                                className="underline decoration-dotted decoration-[#9a9a95] hover:text-[#111110]"><Num v={m.total.actions} /></button>
                              : <Num v={m.total.actions} />}
                          </td>
                          <td className="px-2 py-2 text-right"><Num v={m.total.messagesOwn} /> <span className="text-[#9a9a95]">+{m.total.messagesNoAuthor}</span></td>
                          <td className="px-2 py-2 text-right"><Num v={m.total.clientMessages} muted /></td>
                          <td className="px-2 py-2 text-right"><Num v={fmtWait(m.medianReplyMin)} /></td>
                          <td className="px-2 py-2 text-right"><span className={m.total.unanswered ? 'text-amber-700' : 'text-[#9a9a95]'}>{m.total.unanswered}</span></td>
                          <td className="px-2 py-2 text-right"><Num v={m.total.tasksCompleted} /> <span className="text-[#9a9a95]">/ {m.total.tasksPostponed}</span></td>
                          <td className="px-2 py-2 text-right"><Num v={m.total.callsOutConnected} /> <span className="text-[#9a9a95]">/ {m.total.callsOut}</span></td>
                          <td className="px-2 py-2 text-right"><Num v={m.total.callsInAnswered} /> <span className={m.total.callsInMissed ? 'text-red-600' : 'text-[#9a9a95]'}>/ {m.total.callsInMissed}</span></td>
                          <td className="px-4 py-2 text-right"><Num v={m.total.cardsMoved} /></td>
                        </tr>
                        {open === m.userId && (
                          <tr className="border-b border-[#e4e4e0] bg-[#fafaf8]">
                            <td colSpan={single ? 14 : 15} className="px-4 py-3">
                              <DayRows m={m} s={s} onDay={day => setTl({ userId: m.userId, day, name: m.name })} />
                              {tl && tl.userId === m.userId && (
                                <div className="mt-3 pt-3 border-t border-[#e4e4e0]">
                                  <button onClick={() => setTl(null)} className="text-[11px] text-[#9a9a95] hover:text-[#111110] mb-2">свернуть действия ✕</button>
                                  <ActionTimeline key={`${tl.userId}-${tl.day}`} userId={tl.userId} day={tl.day} name={tl.name} />
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {managers.length === 0 && (
                    <tr><td colSpan={15} className="px-4 py-6 text-center text-[#9a9a95]">За период в AmoCRM нет действий менеджеров</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {others.length > 0 && (
              <details className="bg-white border border-[#e4e4e0] rounded-xl p-4 mb-4">
                <summary className="cursor-pointer text-[13px] font-medium text-[#111110]">
                  Не продавцы — справочно: {others.map(m => m.name).join(', ')}
                </summary>
                <p className="text-[11px] text-[#9a9a95] mt-1 mb-2">
                  Их работа в amo не измеряется воронкой B2C: нормы, подсказки «Мой день» и медиана команды считаются только по продавцам.
                </p>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[11px] text-[#9a9a95] text-left border-b border-[#e4e4e0]">
                      <th className="py-1.5 pr-2 font-normal">Кто</th>
                      <th className="py-1.5 px-2 font-normal text-right">Начало</th>
                      <th className="py-1.5 px-2 font-normal text-right">Конец</th>
                      <th className="py-1.5 px-2 font-normal text-right">Действий</th>
                      <th className="py-1.5 px-2 font-normal text-right">Задачи закрыто</th>
                      <th className="py-1.5 pl-2 font-normal text-right">Карточек передвинуто</th>
                    </tr>
                  </thead>
                  <tbody>
                    {others.map(m => (
                      <tr key={m.userId} className="border-b border-[#f0f0ec]">
                        <td className="py-1.5 pr-2 text-[#111110]">{m.name}</td>
                        <td className="py-1.5 px-2 text-right"><Num v={single ? fmtTime(m.days[0].firstAt) : fmtMinuteOfDay(m.medianStartMin)} /></td>
                        <td className="py-1.5 px-2 text-right"><Num v={single ? fmtTime(m.days[0].lastAt) : fmtMinuteOfDay(m.medianEndMin)} /></td>
                        <td className="py-1.5 px-2 text-right"><Num v={m.total.actions} /></td>
                        <td className="py-1.5 px-2 text-right"><Num v={m.total.tasksCompleted} /></td>
                        <td className="py-1.5 pl-2 text-right"><Num v={m.total.cardsMoved} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}

            {schedules.length > 0 && (() => {
              const sats = saturdayDuty(data.days, managers, new Set(schedules.map(x => x.amo_user_id)))
              if (sats.length === 0) return null
              return (
                <Card title="Суббота — дежурный" hint="По графику суббота — выходной, работает дежурный. Дежурный — менеджер, который в субботу что-то делал в amo.">
                  <ul className="text-[13px] space-y-1">
                    {sats.map(x => (
                      <li key={x.day}>
                        <span className="text-[#9a9a95]">{shortDay(x.day)} сб — </span>
                        {x.onDuty.length === 0
                          ? <span className="text-red-600 font-medium">дежурного не было: ни одного действия в amo</span>
                          : x.onDuty.map((d, i) => (
                            <span key={d.userId} className="text-[#111110]">
                              {i > 0 && ', '}{d.name} <span className="text-[#9a9a95]">{fmtTime(d.firstAt)}–{fmtTime(d.lastAt)} · {d.actions} действ.</span>
                            </span>
                          ))}
                      </li>
                    ))}
                  </ul>
                </Card>
              )
            })()}


          </>
        )}

        {/* Результат не зависит от периода таблицы: монтируется один раз после первой загрузки и
            не пересчитывается при смене периода — иначе каждый клик заново тянет 90 дней из amo
            параллельно с таблицей, и amo рвёт соединения */}
        {resultsOn && <ResultsBlock notSellers={new Set(schedules.filter(x => x.is_seller === false).map(x => x.amo_user_id))} />}

        {resultsOn && <CoachingPreview />}

        {data && !loading && (
          <>
            <PbxBlock from={r.from} to={r.to} names={names} />

            <Card
              title="Кто во сколько работает"
              right={
                <div className="flex items-center gap-3 text-[11px] text-[#9a9a95] flex-wrap">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-[#1f6f43]" /> 15+ действий в час</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-[#3f9a66]" /> 6–14</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-[#a6d4b5]" /> 1–5</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-[#cfdcf0]" /> только сообщения с телефона</span>
                  <span>бледно — до даты выхода</span>
                </div>
              }
            >
              <div className="flex gap-px pl-[180px] mb-1">
                {HOURS.map(h => <div key={h} className="flex-1 min-w-[10px] text-[10px] text-[#9a9a95] text-center">{h}</div>)}
              </div>
              {managers.map(m => {
                const s = scheduleOf(m.userId)
                return (
                  <div key={m.userId} className="mb-3">
                    {!single && <div className="text-[12px] font-medium text-[#111110] mb-1">{m.name}</div>}
                    {m.days.map(d => (
                      <div key={d.day} className="flex items-center gap-2 mb-px">
                        <div className={`w-[172px] shrink-0 text-[11px] truncate ${isWeekend(d.day) ? 'text-[#9a9a95]' : 'text-[#111110]'}`}>
                          {single ? <span className="font-medium">{m.name}</span> : `${shortDay(d.day)} ${weekday(d.day)}`}
                          <span className="text-[#9a9a95]"> {d.firstAt === null ? '—' : `${fmtTime(d.firstAt)}–${fmtTime(d.lastAt)}`}</span>
                        </div>
                        <div className="flex-1"><HourStrip d={d} off={!!s?.starts_on && d.day < s.starts_on} /></div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </Card>

            <WazzupBlock w={data.wazzup} managers={data.managers} />

            <SchedulesBlock managers={active.map(m => ({ userId: m.userId, name: m.name }))} schedules={schedules} onSaved={loadSchedules} />

            <details className="bg-white border border-[#e4e4e0] rounded-xl p-4 text-[12px] text-[#6b6b66]">
              <summary className="cursor-pointer text-[13px] font-medium text-[#111110]">Как считается</summary>
              <ul className="mt-2 space-y-1.5 list-disc pl-5">
                <li><b>Действие</b> — всё, что человек сделал в amo под своим именем: сообщение, звонок, задача, заметка, смена этапа, правка полей. Не считаются: сообщения клиентов, пропущенные звонки и связки «сделка ↔ контакт» — их ставит интеграция заявок, в том числе ночью.</li>
                <li><b>Начало и конец</b> — первое и последнее действие за день. Для периода — медиана по дням, в которые были действия.</li>
                <li><b>По графику</b> — сравнение с графиком ниже (менеджеры: 9:00–18:00, пн–пт; в субботу — дежурный). «Поздний старт» — первое действие в amo позже начала смены больше чем на 15 минут; это не время прихода: читать чаты можно без следа в amo. «Ранний финиш» — последнее действие раньше конца смены больше чем на 15 минут. «Пустой день» — рабочий по графику день без единого действия. До даты выхода дни не в вину. Нет графика — нет и оценки.</li>
                <li><b>Что именно делал</b> — нажми на число в колонке «Действий»: развернётся лента за день, от первого действия до последнего. Число и лента считаются одним правилом, поэтому сходятся.</li>
                <li><b>Имена</b> — из приложения (карточка сотрудника), а не из amo: учётки в amo переименовывали, и они расходятся (amo «Алина» — это Айжан, amo «Дима» — Дмитрий).</li>
                <li><b>Суббота</b> — выходной по графику; кто работал — отмечен «дежурство». Суббота, в которую никто из менеджеров ничего не сделал в amo, — «дежурного не было».</li>
                <li><b>Сообщения «+N»</b> — отправлены без автора: с телефона или из приложения Wazzup, мимо интерфейса amo. amo не знает, кто их отправил, поэтому они засчитаны ответственному по сделке отдельно и рабочее окно не двигают. Кто писал на самом деле — блок «Кто писал из Wazzup».{data.noAuthorUnassigned > 0 && ` Не удалось привязать к сделке: ${data.noAuthorUnassigned}.`}</li>
                <li><b>Ответ клиенту</b> — от первого сообщения клиента до первого нашего ответа в той же беседе, от кого бы он ни пришёл. Берутся только сообщения, пришедшие с 9 до 19.</li>
                <li><b>Звонки</b> в таблице — по заметкам amo (onlinePBX): «дозвонился» и «принято» — разговор состоялся. Звонки мимо карточек и пропущенные на общей линии — в блоке «Телефония».</li>
                <li><b>Результат</b> — этап засчитан тому, кто перевёл сделку вперёд (перевод между этапами оплаты — не новая оплата); «до оплаты» — ответственному. Бюджет сделки в amo — не деньги в кассе.</li>
                <li><b>Задачи</b>: закрыто / перенесено срок. Много переносов при малом числе закрытых — задачи двигают, а не делают.</li>
              </ul>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
