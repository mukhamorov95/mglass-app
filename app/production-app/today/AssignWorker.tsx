'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

type Worker = { id: string; name: string | null; email: string | null; production_stations: string[] | null }

// Назначение задачи рабочему прямо из «Пула на сегодня».
// Пишет production_tasks.assigned_to (RLS разрешает authenticated update).
export default function AssignWorker({ taskId, station, assignedTo, workers }: {
  taskId: number
  station: string
  assignedTo: string | null
  workers: Worker[]
}) {
  const router = useRouter()
  const sb = createClient()
  const [saving, setSaving] = useState(false)

  const atStation = (w: Worker) => (w.production_stations ?? []).includes(station)
  // Сначала рабочие этой станции, потом остальные.
  const sorted = [...workers].sort((a, b) => (atStation(a) ? 0 : 1) - (atStation(b) ? 0 : 1))

  async function assign(workerId: string) {
    setSaving(true)
    await sb.from('production_tasks').update({ assigned_to: workerId || null }).eq('id', taskId)
    setSaving(false)
    router.refresh()
  }

  return (
    <select
      value={assignedTo ?? ''}
      disabled={saving}
      onChange={e => assign(e.target.value)}
      onClick={e => e.stopPropagation()}
      className={`text-[10px] font-medium px-2 py-1 rounded-full border cursor-pointer outline-none max-w-[140px] ${
        assignedTo ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-[#f0f0ec] text-[#9a9a95] border-transparent'
      }`}>
      <option value="">свободно</option>
      {sorted.map(w => (
        <option key={w.id} value={w.id}>
          {(w.name ?? w.email ?? 'рабочий')}{atStation(w) ? '' : ' (др. станция)'}
        </option>
      ))}
    </select>
  )
}
