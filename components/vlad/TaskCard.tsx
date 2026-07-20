'use client'

import { useState } from 'react'
import { ROLE_META, KIND_META, fmtDay, patchTask, type VladTask } from './shared'
import VoiceButton from './VoiceButton'

// Карточка задачи. В inbox-режиме — подтверждение/правка роли и даты.
// Раскрытая — выжимка сверху, детали, шаги-чеклист, дополнительная надиктовка.

type Props = { task: VladTask; inbox?: boolean; onChanged: () => void }

export default function TaskCard({ task: t, inbox, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [editRole, setEditRole] = useState(false)
  const role = ROLE_META[t.role] ?? ROLE_META.other
  const kind = KIND_META[t.kind] ?? KIND_META.task
  const today = new Date().toISOString().slice(0, 10)
  const overdue = t.due_date && t.due_date < today && t.status !== 'done'

  async function toggleStep(i: number) {
    const steps = t.steps.map((s, j) => j === i ? { ...s, done: !s.done } : s)
    await patchTask(t.id, { steps })
    onChanged()
  }

  return (
    <div className={`bg-white rounded-xl border ${overdue ? 'border-red-300' : 'border-[#e4e4e0]'}`}>
      <button onClick={() => setOpen(!open)} className="w-full text-left px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-[#f0f0ec] text-[#6b6b66]">{role.icon} {role.label}</span>
              <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${kind.cls}`}>{kind.label}</span>
              {t.due_date && (
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${overdue ? 'bg-red-600 text-white' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>
                  {overdue ? '🔥 ' : '📅 '}{fmtDay(t.due_date)}
                </span>
              )}
            </div>
            <p className="text-[14px] font-semibold text-[#111110]">{t.title}</p>
            {t.contact && <p className="text-[12px] text-[#9a9a95] mt-0.5">↔ {t.contact}</p>}
          </div>
          <span className="text-[#9a9a95] text-[12px] flex-shrink-0 mt-1">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-[#f0f0ec] px-3.5 py-3 space-y-3">
          {t.details && <p className="text-[13px] text-[#4b4b47] whitespace-pre-wrap">{t.details}</p>}

          {t.steps.length > 0 && (
            <div className="space-y-1.5">
              {t.steps.map((s, i) => (
                <label key={i} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={s.done} onChange={() => toggleStep(i)} className="mt-0.5 accent-[#111110]" />
                  <span className={`text-[13px] ${s.done ? 'text-[#9a9a95] line-through' : 'text-[#111110]'}`}>{s.text}</span>
                </label>
              ))}
            </div>
          )}

          {/* Дополнить голосом */}
          <VoiceButton compact taskId={t.id} onDone={onChanged} />

          {/* Правка роли/даты */}
          {editRole ? (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(ROLE_META).map(([k, v]) => (
                <button key={k} onClick={async () => { await patchTask(t.id, { role: k }); setEditRole(false); onChanged() }}
                  className={`text-[11px] px-2 py-1 rounded-full ${k === t.role ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setEditRole(true)} className="text-[12px] text-[#6b6b66] px-2 py-1 rounded-md border border-[#e4e4e0]">Роль</button>
              <input type="date" defaultValue={t.due_date ?? ''}
                onChange={async e => { await patchTask(t.id, { due_date: e.target.value || null }); onChanged() }}
                className="text-[12px] text-[#6b6b66] px-2 py-1 rounded-md border border-[#e4e4e0] bg-white" />
              {inbox ? (
                <>
                  <button onClick={async () => { await patchTask(t.id, { status: 'active' }); onChanged() }}
                    className="text-[12px] font-semibold text-white bg-[#111110] px-3 py-1 rounded-md">✓ Принять</button>
                  <button onClick={async () => { await patchTask(t.id, { status: 'dropped' }); onChanged() }}
                    className="text-[12px] text-[#9a9a95] px-2 py-1">Убрать</button>
                </>
              ) : (
                <button onClick={async () => { await patchTask(t.id, { status: 'done' }); onChanged() }}
                  className="text-[12px] font-semibold text-emerald-700 border border-emerald-200 px-3 py-1 rounded-md">✓ Сделано</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
