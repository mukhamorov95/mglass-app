'use client'

// Личная вкладка владельца: выгрузить голову голосом → структура по ролям →
// план на день. Вкладки: Сегодня / Входящее / Задачи / Финансы.
// Данные — в отдельной базе vlad-personal, доступ только сервером.

import { useEffect, useState, useCallback } from 'react'
import VoiceButton from '@/components/vlad/VoiceButton'
import TaskCard from '@/components/vlad/TaskCard'
import TodayTab from '@/components/vlad/TodayTab'
import FinanceTab from '@/components/vlad/FinanceTab'
import { ROLE_META, type VladTask } from '@/components/vlad/shared'

type Tab = 'today' | 'inbox' | 'tasks' | 'finance'

export default function VladPage() {
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin] = useState('')
  const [pinErr, setPinErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('today')
  const [inbox, setInbox] = useState<VladTask[]>([])
  const [tasks, setTasks] = useState<VladTask[]>([])
  const [now, setNow] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const [icsSecret, setIcsSecret] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNow(Date.now()) }, [])

  const loadTasks = useCallback(async () => {
    const r = await fetch('/api/vlad/tasks?status=inbox,active')
    if (r.status === 401) { setUnlocked(false); setLoading(false); return }
    const d = await r.json().catch(() => ({}))
    if (r.ok) {
      const all = (d.tasks ?? []) as VladTask[]
      setInbox(all.filter(t => t.status === 'inbox'))
      setTasks(all.filter(t => t.status === 'active'))
      setUnlocked(true)
      setReload(x => x + 1)
    }
    setLoading(false)
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadTasks() }, [loadTasks])

  useEffect(() => {
    if (!unlocked) return
    fetch('/api/vlad/settings').then(r => r.json()).then(d => setIcsSecret(d.ics_secret ?? null)).catch(() => {})
  }, [unlocked])

  async function submitPin() {
    setPinErr(null)
    const r = await fetch('/api/vlad/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) })
    if (!r.ok) { setPinErr((await r.json().catch(() => ({}))).error ?? 'Ошибка'); return }
    setPin('')
    setLoading(true)
    await loadTasks()
  }

  function onVoiceDone(r: { created?: number; appended?: number }) {
    if (r.created) {
      setFlash(`Разобрал: ${r.created} во «Входящем» — подтверди`)
      setTab('inbox')
    } else if (r.created === 0) {
      setFlash('Записал, но задач не услышал — попробуй конкретнее')
    }
    loadTasks()
    setTimeout(() => setFlash(null), 4000)
  }

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-[#111110] flex items-center justify-center px-4">
        <div className="w-full max-w-[320px] text-center">
          <div className="text-[40px] mb-2">🔒</div>
          <h1 className="text-white text-[18px] font-semibold mb-1">Влад</h1>
          <p className="text-[#9a9a95] text-[13px] mb-6">Личное пространство. Введи ПИН.</p>
          <input
            type="password" inputMode="numeric" autoFocus value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitPin()}
            className="w-full text-center text-[24px] tracking-[8px] bg-[#1d1d1c] border border-[#333331] rounded-xl px-4 py-3 text-white outline-none focus:border-[#666]"
          />
          {pinErr && <p className="text-red-400 text-[12px] mt-2">{pinErr}</p>}
          <button onClick={submitPin} className="mt-4 w-full py-3 rounded-xl bg-white text-[#111110] text-[14px] font-semibold">Войти</button>
        </div>
      </div>
    )
  }

  const byRole = new Map<string, VladTask[]>()
  for (const t of tasks) byRole.set(t.role, [...(byRole.get(t.role) ?? []), t])

  const TABS: { key: Tab; label: string }[] = [
    { key: 'today', label: 'Сегодня' },
    { key: 'inbox', label: inbox.length ? `Входящее ${inbox.length}` : 'Входящее' },
    { key: 'tasks', label: 'Задачи' },
    { key: 'finance', label: 'Финансы' },
  ]

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-28">
      {flash && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{flash}</div>}

      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-0 lg:pt-6 sticky top-0 z-40">
        <div className="max-w-[680px] mx-auto">
          <div className="flex items-center justify-between">
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">🔒 Влад</h1>
            <button onClick={async () => { await fetch('/api/vlad/pin', { method: 'DELETE' }); setUnlocked(false) }} className="text-[12px] text-[#9a9a95]">Закрыть</button>
          </div>
          <div className="flex gap-1 mt-3 -mb-px overflow-x-auto">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-3.5 py-2 text-[13px] font-medium whitespace-nowrap border-b-2 ${tab === t.key ? 'border-[#111110] text-[#111110]' : 'border-transparent text-[#9a9a95]'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-[680px] mx-auto px-4 pt-4">
        {tab === 'today' && <TodayTab key={reload} onGoInbox={() => setTab('inbox')} />}

        {tab === 'inbox' && (
          <div className="space-y-2">
            {inbox.length === 0
              ? <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
                  <p className="text-[14px] font-medium text-[#111110]">Входящее пусто</p>
                  <p className="text-[13px] text-[#9a9a95] mt-1">Надиктуй — кнопка внизу. Всё сказанное разложится по ролям и попадёт сюда на подтверждение.</p>
                </div>
              : inbox.map(t => <TaskCard key={t.id} task={t} inbox onChanged={loadTasks} />)}
          </div>
        )}

        {tab === 'tasks' && (
          <div className="space-y-4">
            {tasks.length === 0 && (
              <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
                <p className="text-[14px] font-medium text-[#111110]">Активных задач нет</p>
                <p className="text-[13px] text-[#9a9a95] mt-1">Подтверждённые из «Входящего» появятся здесь, сгруппированные по ролям.</p>
              </div>
            )}
            {[...byRole.entries()].map(([role, list]) => {
              const meta = ROLE_META[role] ?? ROLE_META.other
              return (
                <div key={role} className="space-y-2">
                  <h3 className="text-[13px] font-bold text-[#111110]">{meta.icon} {meta.label} · {list.length}</h3>
                  {list.map(t => <TaskCard key={t.id} task={t} onChanged={loadTasks} />)}
                </div>
              )
            })}
            {icsSecret && (
              <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
                <p className="text-[13px] font-semibold text-[#111110]">📅 Календарь</p>
                <p className="text-[12px] text-[#9a9a95] mt-1">Подпишись один раз — задачи со сроками сами появятся в Apple/Google Calendar:</p>
                <code className="block mt-2 text-[11px] bg-[#f5f5f3] rounded-lg p-2 break-all select-all">
                  {`https://mglass-app.vercel.app/api/vlad/calendar/${icsSecret}`}
                </code>
                <p className="text-[11px] text-[#9a9a95] mt-1.5">iPhone: Настройки → Календарь → Учётные записи → Подписной календарь</p>
              </div>
            )}
          </div>
        )}

        {tab === 'finance' && <FinanceTab now={now} />}
      </div>

      {/* Плавающая кнопка записи — всегда под рукой */}
      {tab !== 'finance' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          <VoiceButton onDone={onVoiceDone} />
        </div>
      )}
    </div>
  )
}
