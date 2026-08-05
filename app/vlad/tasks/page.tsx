'use client'

import { useEffect, useState } from 'react'

type Task = {
  id: number; title: string; details: string; category: string; priority: string
  source: string; status: string; result_note: string | null; created_at: string; updated_at: string
}

const STATUS: Record<string, { label: string; cls: string }> = {
  queued:      { label: 'В очереди',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  in_progress: { label: 'В работе',   cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  done:        { label: 'Сделано',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled:   { label: 'Отменена',   cls: 'bg-[#f0f0ec] text-[#9a9a95] border-[#e4e4e0]' },
}
const PRIORITY: Record<string, string> = {
  high:   'text-red-600',
  normal: 'text-[#6b6b66]',
  low:    'text-[#9a9a95]',
}
const ORDER = ['queued', 'in_progress', 'done', 'cancelled']

function fmt(d: string) {
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function OwnerTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)

  async function load() {
    const r = await fetch('/api/vlad/owner-tasks')
    const j = await r.json()
    setTasks((j.tasks ?? []) as Task[])
    setLoading(false)
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  async function act(id: number, action: 'take' | 'done' | 'cancel' | 'requeue') {
    let note: string | undefined
    if (action === 'done') note = window.prompt('Что сделано? (необязательно)') ?? undefined
    setBusy(id)
    await fetch('/api/vlad/owner-tasks', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, action, note }),
    })
    await load()
    setBusy(null)
  }

  const sorted = [...tasks].sort((a, b) => {
    const s = ORDER.indexOf(a.status) - ORDER.indexOf(b.status)
    if (s !== 0) return s
    return +new Date(b.created_at) - +new Date(a.created_at)
  })
  const queued = tasks.filter(t => t.status === 'queued').length
  const inWork = tasks.filter(t => t.status === 'in_progress').length

  return (
    <div className="max-w-[820px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Задачи из Telegram-бота</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">
          Очередь: <b className="text-amber-700">{queued}</b> · в работе: <b className="text-blue-700">{inWork}</b>
          {' · '}диктуешь боту — появляется здесь сразу
        </p>
      </div>

      {loading ? (
        <div className="text-[13px] text-[#9a9a95] py-10 text-center">Загрузка…</div>
      ) : sorted.length === 0 ? (
        <div className="text-[13px] text-[#9a9a95] py-10 text-center">Задач нет. Надиктуй боту «📝 Задача в систему».</div>
      ) : (
        <div className="space-y-2.5">
          {sorted.map(t => {
            const st = STATUS[t.status] ?? STATUS.queued
            const done = t.status === 'done' || t.status === 'cancelled'
            return (
              <div key={t.id} className={`bg-white border border-[#e4e4e0] rounded-xl p-4 ${done ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono text-[#9a9a95]">#{t.id}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wide ${PRIORITY[t.priority] ?? PRIORITY.normal}`}>{t.priority}</span>
                      <span className="text-[10px] text-[#9a9a95] bg-[#f5f5f3] border border-[#e4e4e0] rounded px-1.5 py-0.5">{t.category}</span>
                      <span className="text-[10px] text-[#9a9a95]">{t.source === 'voice' ? '🎙 голос' : '⌨️ текст'}</span>
                    </div>
                    <div className="text-[14px] font-medium text-[#111110] mt-1.5">{t.title}</div>
                    {t.details && t.details !== t.title && (
                      <div className="text-[13px] text-[#6b6b66] mt-0.5 whitespace-pre-wrap">{t.details}</div>
                    )}
                    {t.result_note && (
                      <div className="text-[12px] text-emerald-700 mt-1.5">✓ {t.result_note}</div>
                    )}
                    <div className="text-[11px] text-[#c4c4be] mt-1.5">{fmt(t.created_at)}</div>
                  </div>
                  <span className={`shrink-0 text-[11px] font-medium border rounded-full px-2.5 py-1 ${st.cls}`}>{st.label}</span>
                </div>

                <div className="flex gap-2 mt-3">
                  {t.status === 'queued' && (
                    <>
                      <button onClick={() => act(t.id, 'take')} disabled={busy === t.id}
                        className="text-[12px] font-medium bg-[#111110] text-white px-3 py-1.5 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">Взять в работу</button>
                      <button onClick={() => act(t.id, 'cancel')} disabled={busy === t.id}
                        className="text-[12px] text-[#9a9a95] px-3 py-1.5 rounded-lg hover:text-[#6b6b66]">Отменить</button>
                    </>
                  )}
                  {t.status === 'in_progress' && (
                    <>
                      <button onClick={() => act(t.id, 'done')} disabled={busy === t.id}
                        className="text-[12px] font-medium bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-40">Закрыть</button>
                      <button onClick={() => act(t.id, 'requeue')} disabled={busy === t.id}
                        className="text-[12px] text-[#9a9a95] px-3 py-1.5 rounded-lg hover:text-[#6b6b66]">В очередь</button>
                    </>
                  )}
                  {done && (
                    <button onClick={() => act(t.id, 'requeue')} disabled={busy === t.id}
                      className="text-[12px] text-[#9a9a95] px-3 py-1.5 rounded-lg hover:text-[#6b6b66]">Вернуть в очередь</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
