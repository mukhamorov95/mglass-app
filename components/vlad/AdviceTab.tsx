'use client'

// «Предложения»: разборы AI-советника (утро/вечер). Раскрывающиеся пункты:
// «проанализировал → вижу → предлагаю». Советник только советует — любые
// действия по задачам/финансам владелец делает сам в соседних вкладках.

import { useEffect, useState, useCallback } from 'react'

type AdviceItem = { point: string; detail: string; kind: string }
type Advice = { id: number; slot: string; title: string; items: AdviceItem[]; read: boolean; created_at: string }

const KIND_META: Record<string, { icon: string; label: string }> = {
  finance:    { icon: '💰', label: 'Финансы' },
  tasks:      { icon: '📋', label: 'Задачи' },
  discipline: { icon: '💪', label: 'Дисциплина' },
  idea:       { icon: '💡', label: 'Идея' },
}
const SLOT_LABEL: Record<string, string> = { morning: '🌅 Утренний разбор', evening: '🌙 Вечерний разбор', manual: 'Разбор' }

export default function AdviceTab() {
  const [advice, setAdvice] = useState<Advice[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<number | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/vlad/advice')
    const d = await r.json().catch(() => ({}))
    if (r.ok) setAdvice(d.advice ?? [])
    setLoading(false)
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function toggleOpen(a: Advice) {
    const next = open === a.id ? null : a.id
    setOpen(next)
    if (next && !a.read) {
      await fetch('/api/vlad/advice', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, read: true }) })
      setAdvice(prev => prev.map(x => x.id === a.id ? { ...x, read: true } : x))
    }
  }

  if (loading) return <div className="py-10 text-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short' }) +
    ' · ' + new Date(iso).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-2">
      {advice.length === 0 && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
          <p className="text-[14px] font-medium text-[#111110]">Разборов пока нет</p>
          <p className="text-[13px] text-[#9a9a95] mt-1">Советник заходит сам — утром к 9:00 и вечером к 19:00. Проанализирует финансы, задачи и дисциплину, предложения появятся здесь.</p>
        </div>
      )}
      {advice.map(a => (
        <div key={a.id} className={`bg-white rounded-xl border ${!a.read ? 'border-[#111110]' : 'border-[#e4e4e0]'}`}>
          <button onClick={() => toggleOpen(a)} className="w-full text-left px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] text-[#9a9a95]">{SLOT_LABEL[a.slot] ?? a.slot} · {fmtWhen(a.created_at)}{!a.read && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#111110] text-white">новый</span>}</p>
                <p className="text-[14px] font-semibold text-[#111110] mt-0.5">{a.title}</p>
              </div>
              <span className="text-[#9a9a95] text-[12px] flex-shrink-0">{open === a.id ? '▲' : '▼'}</span>
            </div>
          </button>
          {open === a.id && (
            <div className="border-t border-[#f0f0ec] px-4 py-3 space-y-3">
              {a.items.map((it, i) => {
                const k = KIND_META[it.kind] ?? KIND_META.idea
                return (
                  <div key={i}>
                    <p className="text-[13px] font-semibold text-[#111110]">{k.icon} {it.point}</p>
                    <p className="text-[13px] text-[#4b4b47] mt-0.5 whitespace-pre-wrap">{it.detail}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
