'use client'

import { useState } from 'react'

// А18 не был закончен: план менеджера умел сохраняться через API, но вводить его
// было негде — блок план/факт показывал «план не задан» и починить это было нельзя.
// Ставит план владелец или коммерческий (RLS b2b_manager_plans).

type Row = { managerId: string | null; name: string; plan: number; launched: number }

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

export default function PlanEditor({ rows, month, onSaved }: {
  rows: Row[]
  month: string
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(managerId: string | null) {
    if (!managerId) return
    const amount = Math.max(0, Math.round(Number((draft[managerId] ?? '').replace(/[^\d]/g, '')) || 0))
    setSaving(managerId); setError(null)
    try {
      const r = await fetch('/api/b2b-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerId, month, amount }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Не удалось сохранить план'); return }
      onSaved()
    } finally { setSaving(null) }
  }

  const withManager = rows.filter(r => r.managerId)
  if (withManager.length === 0) return null

  return (
    <div className="mb-4">
      <button onClick={() => setOpen(v => !v)}
        className="text-[12px] font-medium px-3 py-1.5 rounded-xl border border-[#e4e4e0] bg-white text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors">
        {open ? 'Скрыть планы' : `Планы на ${month}`}
      </button>

      {open && (
        <div className="mt-2 bg-white border border-[#e4e4e0] rounded-2xl divide-y divide-[#f0f0ec]">
          {withManager.map(r => (
            <div key={r.managerId} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
              <span className="text-[13px] text-[#111110] flex-1 min-w-0 truncate">{r.name}</span>
              <span className="text-[11px] text-[#9a9a95] whitespace-nowrap">факт {fmt(r.launched)}</span>
              <input
                value={draft[r.managerId!] ?? (r.plan > 0 ? String(Math.round(r.plan)) : '')}
                onChange={e => setDraft(p => ({ ...p, [r.managerId!]: e.target.value }))}
                placeholder="план, ₽" inputMode="numeric"
                className="w-32 border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono text-right outline-none focus:border-[#111110]" />
              <button onClick={() => save(r.managerId)} disabled={saving === r.managerId}
                className="text-[11px] font-semibold px-3 py-1 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                {saving === r.managerId ? '…' : 'Сохранить'}
              </button>
            </div>
          ))}
          {error && <p className="px-4 py-2 text-[11px] text-red-600">{error}</p>}
          <p className="px-4 py-2 text-[10px] text-[#9a9a95]">
            План на месяц по запуску B2B-заказов. Факт считается из заказов и не редактируется.
          </p>
        </div>
      )}
    </div>
  )
}
