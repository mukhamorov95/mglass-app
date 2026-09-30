'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Schedule } from '@/lib/measure/slots'

// Рабочие часы и выходные/отпуск замерщика. Замерщик правит свои, владелец —
// любого. Всё, что здесь сохранено, сразу видно на доске занятости у менеджеров:
// выходной — «🌴», часы — границы свободных окон.

type M = { id: string; name: string; schedule: Schedule }
type Off = { id: number; measurer_id: string; date_from: string; date_to: string; note: string | null; created_by_name: string | null }

const DAYS = [
  { n: 1, l: 'пн' }, { n: 2, l: 'вт' }, { n: 3, l: 'ср' }, { n: 4, l: 'чт' },
  { n: 5, l: 'пт' }, { n: 6, l: 'сб' }, { n: 7, l: 'вс' },
]
const fmtDate = (d: string) => d.split('-').reverse().slice(0, 2).join('.')

export default function MeasurerAvailability({ onChanged }: { onChanged?: () => void }) {
  const [measurers, setMeasurers] = useState<M[]>([])
  const [daysOff, setDaysOff] = useState<Off[]>([])
  const [canPick, setCanPick] = useState(false)
  const [who, setWho] = useState('')
  const [sch, setSch] = useState<Schedule | null>(null)
  const [offFrom, setOffFrom] = useState('')
  const [offTo, setOffTo] = useState('')
  const [offNote, setOffNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/measurers/days-off', { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setError(j.error || `График не загрузился (${res.status})`); return }
    setError('')
    setMeasurers(j.measurers); setDaysOff(j.daysOff); setCanPick(j.canPickMeasurer)
    setWho(prev => prev && (j.measurers as M[]).some(m => m.id === prev) ? prev : (j.measurers[0]?.id ?? ''))
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const current = measurers.find(m => m.id === who) ?? null
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSch(current ? { ...current.schedule } : null) }, [current])

  async function call(url: string, init: RequestInit, okText: string) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg({ ok: false, text: j.error || `Не сохранено (${res.status})` }); return null }
      setMsg({ ok: true, text: okText })
      await load(); onChanged?.()
      return j
    } finally { setBusy(false) }
  }

  async function saveSchedule() {
    if (!current || !sch) return
    await call('/api/measurers/schedule', {
      method: 'PUT', body: JSON.stringify({ measurer_id: current.id, ...sch }),
    }, `Часы ${current.name} сохранены — менеджеры видят их на доске занятости.`)
  }

  async function addOff() {
    if (!current || !offFrom) return
    const j = await call('/api/measurers/days-off', {
      method: 'POST', body: JSON.stringify({ measurer_id: current.id, date_from: offFrom, date_to: offTo || offFrom, note: offNote }),
    }, `Выходной ${current.name} ${fmtDate(offFrom)}${offTo && offTo !== offFrom ? `–${fmtDate(offTo)}` : ''} сохранён — на доске эти дни закрыты.`)
    if (j) {
      setOffFrom(''); setOffTo(''); setOffNote('')
      const clashes = (j.clashes ?? []) as { id: number }[]
      if (clashes.length) setMsg({ ok: false, text: `Выходной сохранён, но на эти дни уже назначено замеров: ${clashes.length}. Их нужно перенести или вернуть в пул.` })
    }
  }

  async function removeOff(o: Off) {
    if (!window.confirm(`Убрать выходной ${fmtDate(o.date_from)}${o.date_to !== o.date_from ? `–${fmtDate(o.date_to)}` : ''}?`)) return
    await call(`/api/measurers/days-off?id=${o.id}`, { method: 'DELETE' }, 'Выходной убран.')
  }

  if (error) return <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 text-[12px] text-red-600">{error}</div>
  if (!measurers.length) return null

  const inp = 'bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px]'
  const mine = daysOff.filter(o => o.measurer_id === who)

  return (
    <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mr-auto">
          {canPick ? 'График замерщиков' : 'Мой график'}
        </p>
        {canPick && measurers.length > 1 && (
          <select value={who} onChange={e => setWho(e.target.value)} className={inp}>
            {measurers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>

      {sch && (
        <div>
          <p className="text-[12px] font-semibold text-[#4b4b47] mb-1.5">Рабочие дни и часы</p>
          <div className="flex items-center gap-1 flex-wrap">
            {DAYS.map(d => {
              const on = sch.work_days.includes(d.n)
              return (
                <button key={d.n} onClick={() => setSch({ ...sch, work_days: on ? sch.work_days.filter(x => x !== d.n) : [...sch.work_days, d.n].sort() })}
                  className={`text-[12px] w-9 py-1 rounded-lg border ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#9a9a95] border-[#e4e4e0]'}`}>
                  {d.l}
                </button>
              )
            })}
            <span className="text-[12px] text-[#6b6b66] ml-2">с</span>
            <input type="time" value={sch.work_from} onChange={e => setSch({ ...sch, work_from: e.target.value })} className={inp} />
            <span className="text-[12px] text-[#6b6b66]">до</span>
            <input type="time" value={sch.work_to} onChange={e => setSch({ ...sch, work_to: e.target.value })} className={inp} />
            <button onClick={saveSchedule} disabled={busy}
              className="text-[12px] font-semibold bg-[#111110] text-white rounded-lg px-3 py-1.5 hover:bg-[#2a2a28] disabled:opacity-40 ml-1">
              Сохранить часы
            </button>
          </div>
        </div>
      )}

      <div>
        <p className="text-[12px] font-semibold text-[#4b4b47] mb-1.5">Выходные и отпуск</p>
        {mine.length === 0 ? <p className="text-[12px] text-[#c4c4be] mb-2">Впереди выходных не отмечено.</p> : (
          <div className="space-y-1 mb-2">
            {mine.map(o => (
              <div key={o.id} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono">🌴 {fmtDate(o.date_from)}{o.date_to !== o.date_from ? `–${fmtDate(o.date_to)}` : ''}</span>
                {o.note && <span className="text-[#6b6b66]">{o.note}</span>}
                <button onClick={() => removeOff(o)} disabled={busy} className="ml-auto text-[11px] text-[#9a9a95] hover:text-red-600">убрать</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] text-[#6b6b66]">с</span>
          <input type="date" value={offFrom} onChange={e => setOffFrom(e.target.value)} className={inp} />
          <span className="text-[12px] text-[#6b6b66]">по</span>
          <input type="date" value={offTo} min={offFrom || undefined} onChange={e => setOffTo(e.target.value)} className={inp} />
          <input value={offNote} onChange={e => setOffNote(e.target.value)} placeholder="причина (видят только ты и владелец)" className={`${inp} flex-1 min-w-[160px]`} />
          <button onClick={addOff} disabled={busy || !offFrom}
            className="text-[12px] font-semibold border border-[#e4e4e0] rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3] disabled:opacity-40">
            🌴 Добавить
          </button>
        </div>
      </div>

      {msg && <p className={`text-[12px] ${msg.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{msg.text}</p>}
    </div>
  )
}
