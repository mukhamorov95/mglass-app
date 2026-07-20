'use client'

// «Сегодня»: что горит по срокам + спорт-чеклист с серией.
// Отбор задач детерминированный (/api/vlad/today), утро не зависит от AI.

import { useEffect, useState, useCallback } from 'react'
import TaskCard from './TaskCard'
import type { VladTask } from './shared'

type Plan = { overdue: VladTask[]; dueToday: VladTask[]; dueSoon: VladTask[]; inboxCount: number }
type Sport = { exercises: string[]; today: { exercise: string; done: boolean }[]; streak: number; todayComplete: boolean }

export default function TodayTab({ onGoInbox }: { onGoInbox: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [sport, setSport] = useState<Sport | null>(null)
  const [editSport, setEditSport] = useState(false)
  const [sportText, setSportText] = useState('')

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      fetch('/api/vlad/today').then(r => r.json()).catch(() => null),
      fetch('/api/vlad/sport').then(r => r.json()).catch(() => null),
    ])
    if (p && !p.error) setPlan(p)
    if (s && !s.error) { setSport(s); setSportText((s.exercises ?? []).join('\n')) }
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function toggle(exercise: string, done: boolean) {
    await fetch('/api/vlad/sport', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exercise, done }) })
    await load()
  }

  async function saveExercises() {
    await fetch('/api/vlad/sport', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exercises: sportText.split('\n').map(s => s.trim()).filter(Boolean) }) })
    setEditSport(false)
    await load()
  }

  if (!plan) return <div className="py-10 text-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  return (
    <div className="space-y-4">
      {plan.inboxCount > 0 && (
        <button onClick={onGoInbox} className="w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-left">
          <p className="text-[14px] font-semibold text-amber-800">📥 Во входящем {plan.inboxCount} — разбери</p>
          <p className="text-[12px] text-amber-700">Надиктованное ждёт подтверждения</p>
        </button>
      )}

      {plan.overdue.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[13px] font-bold text-red-600">🔥 Горит ({plan.overdue.length})</h3>
          {plan.overdue.map(t => <TaskCard key={t.id} task={t} inbox={t.status === 'inbox'} onChanged={load} />)}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-[13px] font-bold text-[#111110]">Сегодня</h3>
        {plan.dueToday.length === 0
          ? <p className="text-[13px] text-[#9a9a95] bg-white rounded-xl border border-[#e4e4e0] p-4">На сегодня сроков нет{plan.dueSoon.length > 0 ? ' — посмотри ближайшие ниже' : ''}.</p>
          : plan.dueToday.map(t => <TaskCard key={t.id} task={t} inbox={t.status === 'inbox'} onChanged={load} />)}
      </div>

      {plan.dueSoon.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[13px] font-bold text-[#6b6b66]">Ближайшие 7 дней</h3>
          {plan.dueSoon.map(t => <TaskCard key={t.id} task={t} inbox={t.status === 'inbox'} onChanged={load} />)}
        </div>
      )}

      {/* Спорт */}
      {sport && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[14px] font-bold text-[#111110]">💪 Спорт</h3>
            <div className="flex items-center gap-2">
              {sport.streak > 0 && <span className="text-[12px] font-bold text-orange-600">🔥 {sport.streak} дн подряд</span>}
              <button onClick={() => setEditSport(!editSport)} className="text-[12px] text-[#9a9a95]">⚙</button>
            </div>
          </div>
          {editSport ? (
            <div className="space-y-2">
              <textarea value={sportText} onChange={e => setSportText(e.target.value)} rows={4}
                placeholder={'Отжимания\nПриседания'}
                className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
              <p className="text-[11px] text-[#9a9a95]">Одно упражнение — одна строка</p>
              <button onClick={saveExercises} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-medium">Сохранить</button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {sport.today.map(e => (
                <label key={e.exercise} className="flex items-center gap-2.5 cursor-pointer py-0.5">
                  <input type="checkbox" checked={e.done} onChange={() => toggle(e.exercise, !e.done)} className="w-4 h-4 accent-[#111110]" />
                  <span className={`text-[14px] ${e.done ? 'text-[#9a9a95] line-through' : 'text-[#111110]'}`}>{e.exercise}</span>
                </label>
              ))}
              {sport.todayComplete && <p className="text-[12px] font-medium text-emerald-700 pt-1">✓ День закрыт. Серия растёт.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
