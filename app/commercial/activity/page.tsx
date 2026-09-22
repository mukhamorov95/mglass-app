'use client'

import { Fragment, useEffect, useState } from 'react'
import {
  fmtMinuteOfDay, fmtTime, median, mskDay,
  type AmoActivityReport, type DayActivity, type ManagerActivity,
} from '@/lib/amoActivity'

// Рабочий день менеджеров по AmoCRM. Команда общается с клиентами только через amo,
// поэтому след в amo — это и есть рабочий день. Ноль здесь — повод спросить, а не
// приговор: отпуск, больничный и работа мимо amo выглядят одинаково.

type Preset = 'today' | 'yesterday' | 'week' | 'two' | 'day'
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Сегодня' }, { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: '7 дней' }, { key: 'two', label: '14 дней' }, { key: 'day', label: 'День' },
]
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7) // 07:00–22:59
const WEEKDAY = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

const nowTs = () => Math.floor(Date.now() / 1000)
const weekday = (day: string) => WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()]
const isWeekend = (day: string) => { const d = new Date(`${day}T12:00:00Z`).getUTCDay(); return d === 0 || d === 6 }
const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`
const fmtWait = (min: number | null) =>
  min === null ? '—' : min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч ${min % 60 ? `${min % 60} мин` : ''}`.trim()

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

function HourStrip({ d }: { d: DayActivity }) {
  return (
    <div className="flex gap-px">
      {HOURS.map(h => (
        <div key={h} title={`${String(h).padStart(2, '0')}:00 — действий ${d.hourly[h]}, сообщений с телефона ${d.hourlyNoAuthor[h]}`}
          className={`h-4 flex-1 min-w-[10px] rounded-[2px] ${cellColor(d.hourly[h], d.hourlyNoAuthor[h])}`} />
      ))}
    </div>
  )
}

function Num({ v, muted }: { v: number | string; muted?: boolean }) {
  return <span className={muted || v === 0 ? 'text-[#9a9a95]' : 'text-[#111110]'}>{v}</span>
}

function DayRows({ m }: { m: ManagerActivity }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="text-[#9a9a95] text-left">
          <th className="py-1 pr-3 font-normal">День</th>
          <th className="py-1 pr-3 font-normal">Начало–конец</th>
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
            <td className="py-1 pr-3 text-right"><Num v={d.activeHours} /></td>
            <td className="py-1 pr-3 text-right"><Num v={d.firstAt === null ? '—' : fmtWait(d.longestPauseMin)} muted /></td>
            <td className="py-1 pr-3 text-right"><Num v={d.actions} /></td>
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

export default function AmoActivityPage() {
  const [preset, setPreset] = useState<Preset>('today')
  const [day, setDay] = useState(() => mskDay(nowTs() - 86400))
  const [data, setData] = useState<AmoActivityReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const r = range(preset, day)
    fetch(`/api/commercial/amo-activity?from=${r.from}&to=${r.to}`)
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Ошибка ${res.status}`)
        if (!cancelled) { setData(json as AmoActivityReport); setError(null) }
      })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setData(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [preset, day])

  const choosePreset = (p: Preset) => { if (p !== preset) { setPreset(p); setLoading(true) } }
  const chooseDay = (v: string) => { if (v && v !== day) { setDay(v); setLoading(true) } }

  const managers = (data?.managers ?? []).filter(m => m.total.actions > 0 || m.total.messagesNoAuthor > 0)
  const single = (data?.days.length ?? 0) === 1
  const firstStarter = single
    ? managers.filter(m => m.days[0].firstAt !== null).sort((a, b) => a.days[0].firstAt! - b.days[0].firstAt!)[0]
    : undefined

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-4">
          <h1 className="text-[18px] font-semibold text-[#111110]">Рабочий день менеджеров</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">
            По действиям в AmoCRM, московское время. Кто во сколько начал и закончил, сообщения, звонки, задачи.
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

        {loading && <div className="bg-white border border-[#e4e4e0] rounded-xl p-6 text-[13px] text-[#9a9a95]">Загружаю из AmoCRM… за 14 дней это до минуты.</div>}
        {error && <div className="bg-white border border-red-200 rounded-xl p-4 text-[13px] text-red-700">{error}</div>}

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
                  {managers.map(m => {
                    const d0 = m.days[0]
                    return (
                      <Fragment key={m.userId}>
                        <tr onClick={() => setOpen(open === m.userId ? null : m.userId)}
                          className="border-b border-[#f0f0ec] hover:bg-[#fafaf8] cursor-pointer">
                          <td className="px-4 py-2 font-medium text-[#111110]">{open === m.userId ? '▾' : '▸'} {m.name}</td>
                          {!single && <td className="px-2 py-2 text-right"><Num v={`${m.workDays} из ${data.days.length}`} /></td>}
                          <td className="px-2 py-2 text-right"><Num v={single ? fmtTime(d0.firstAt) : fmtMinuteOfDay(m.medianStartMin)} /></td>
                          <td className="px-2 py-2 text-right"><Num v={single ? fmtTime(d0.lastAt) : fmtMinuteOfDay(m.medianEndMin)} /></td>
                          <td className="px-2 py-2 text-right"><Num v={single ? d0.activeHours : m.avgActiveHours} /></td>
                          <td className="px-2 py-2 text-right"><Num v={m.total.actions} /></td>
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
                            <td colSpan={single ? 13 : 14} className="px-4 py-3"><DayRows m={m} /></td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {managers.length === 0 && (
                    <tr><td colSpan={14} className="px-4 py-6 text-center text-[#9a9a95]">За период в AmoCRM нет действий менеджеров</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 mb-4">
              <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-[14px] font-semibold text-[#111110]">Кто во сколько работает</h2>
                <div className="flex items-center gap-3 text-[11px] text-[#9a9a95]">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-[#1f6f43]" /> 15+ действий в час</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-[#3f9a66]" /> 6–14</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-[#a6d4b5]" /> 1–5</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-[#cfdcf0]" /> только сообщения с телефона</span>
                </div>
              </div>
              <div className="flex gap-px pl-[180px] mb-1">
                {HOURS.map(h => <div key={h} className="flex-1 min-w-[10px] text-[10px] text-[#9a9a95] text-center">{h}</div>)}
              </div>
              {managers.map(m => (
                <div key={m.userId} className="mb-3">
                  {!single && <div className="text-[12px] font-medium text-[#111110] mb-1">{m.name}</div>}
                  {m.days.map(d => (
                    <div key={d.day} className="flex items-center gap-2 mb-px">
                      <div className={`w-[172px] shrink-0 text-[11px] truncate ${isWeekend(d.day) ? 'text-[#9a9a95]' : 'text-[#111110]'}`}>
                        {single ? <span className="font-medium">{m.name}</span> : `${shortDay(d.day)} ${weekday(d.day)}`}
                        <span className="text-[#9a9a95]"> {d.firstAt === null ? '—' : `${fmtTime(d.firstAt)}–${fmtTime(d.lastAt)}`}</span>
                      </div>
                      <div className="flex-1"><HourStrip d={d} /></div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <details className="bg-white border border-[#e4e4e0] rounded-xl p-4 text-[12px] text-[#6b6b66]">
              <summary className="cursor-pointer text-[13px] font-medium text-[#111110]">Как считается</summary>
              <ul className="mt-2 space-y-1.5 list-disc pl-5">
                <li><b>Действие</b> — всё, что человек сделал в amo под своим именем: сообщение, звонок, задача, заметка, смена этапа, правка полей. Не считаются: сообщения клиентов, пропущенные звонки и связки «сделка ↔ контакт» — их ставит интеграция заявок, в том числе ночью.</li>
                <li><b>Начало и конец</b> — первое и последнее действие за день. Для периода — медиана по дням, в которые были действия.</li>
                <li><b>Сообщения «+N»</b> — отправлены без автора: с телефона или из приложения Wazzup, мимо интерфейса amo. Кто именно отправил, amo не знает, поэтому они засчитаны ответственному по сделке отдельно и рабочее окно не двигают. Таких сообщений больше половины.{data.noAuthorUnassigned > 0 && ` Не удалось привязать к сделке: ${data.noAuthorUnassigned}.`}</li>
                <li><b>Ответ клиенту</b> — от первого сообщения клиента до первого нашего ответа в той же беседе, от кого бы он ни пришёл. Берутся только сообщения, пришедшие с 9 до 19, чтобы ночь не выглядела медленным ответом.</li>
                <li><b>Звонки</b> — по заметкам телефонии (onlinePBX): «дозвонился» и «принято» — разговор состоялся, иначе — не дозвонился / пропущен.</li>
                <li><b>Задачи</b>: закрыто / перенесено срок. Много переносов при малом числе закрытых — задачи двигают, а не делают.</li>
                <li>Пустой день — сначала вопрос, а не вывод: отпуск, больничный и работа мимо amo выглядят одинаково.</li>
              </ul>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
