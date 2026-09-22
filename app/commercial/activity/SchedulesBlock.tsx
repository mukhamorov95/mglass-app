'use client'

import { useState } from 'react'
import { fmtHm, type ManagerSchedule } from '@/lib/managerSchedule'
import { Card } from './ui'

// Норма, с которой сравнивается факт. Пустой график — экран ничего не ставит в вину:
// без договорённости «короткий день» может быть согласованным.

const DAYS = [
  { n: 1, l: 'пн' }, { n: 2, l: 'вт' }, { n: 3, l: 'ср' }, { n: 4, l: 'чт' },
  { n: 5, l: 'пт' }, { n: 6, l: 'сб' }, { n: 7, l: 'вс' },
]

type Draft = { starts_on: string; work_from: string; work_to: string; work_days: number[]; note: string; is_seller: boolean }

function Row({ userId, name, s, onSaved }: { userId: number; name: string; s?: ManagerSchedule; onSaved: () => void }) {
  const [d, setD] = useState<Draft>({
    starts_on: s?.starts_on ?? '', work_from: fmtHm(s?.work_from ?? null), work_to: fmtHm(s?.work_to ?? null),
    work_days: s?.work_days ?? [1, 2, 3, 4, 5], note: s?.note ?? '', is_seller: s?.is_seller !== false,
  })
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle')

  const save = async () => {
    setState('saving')
    const res = await fetch('/api/commercial/manager-schedules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amo_user_id: userId, name, ...d }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setState(json.error ?? `Ошибка ${res.status}`); return }
    setState('saved')
    onSaved()
  }

  const input = 'border border-[#e4e4e0] rounded-md px-2 py-1 text-[12px] text-[#111110] bg-white'
  return (
    <tr className="border-b border-[#f0f0ec] align-top">
      <td className="py-2 pr-2 font-medium text-[#111110] text-[13px]">
        {name}
        <label className="flex items-center gap-1 mt-1 text-[11px] font-normal text-[#6b6b66]">
          <input type="checkbox" checked={d.is_seller} onChange={e => setD({ ...d, is_seller: e.target.checked })} />
          продавец B2C
        </label>
      </td>
      <td className="py-2 px-1"><input type="date" className={input} value={d.starts_on} onChange={e => setD({ ...d, starts_on: e.target.value })} /></td>
      <td className="py-2 px-1 whitespace-nowrap">
        <input type="time" className={input} value={d.work_from} onChange={e => setD({ ...d, work_from: e.target.value })} />
        <span className="text-[#9a9a95] mx-1">–</span>
        <input type="time" className={input} value={d.work_to} onChange={e => setD({ ...d, work_to: e.target.value })} />
      </td>
      <td className="py-2 px-1">
        <div className="flex gap-0.5">
          {DAYS.map(x => {
            const on = d.work_days.includes(x.n)
            return (
              <button key={x.n} type="button"
                onClick={() => setD({ ...d, work_days: on ? d.work_days.filter(n => n !== x.n) : [...d.work_days, x.n] })}
                className={`w-7 py-1 rounded text-[11px] ${on ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#9a9a95]'}`}>
                {x.l}
              </button>
            )
          })}
        </div>
      </td>
      <td className="py-2 px-1"><input className={`${input} w-full min-w-[140px]`} value={d.note} placeholder="договорённость" onChange={e => setD({ ...d, note: e.target.value })} /></td>
      <td className="py-2 pl-1 whitespace-nowrap">
        <button onClick={save} disabled={state === 'saving'}
          className="px-3 py-1 rounded-md text-[12px] bg-[#111110] text-white disabled:opacity-50">Сохранить</button>
        {state === 'saved' && <span className="ml-2 text-[11px] text-green-700">сохранено — учтено в колонке «По графику» выше</span>}
        {state !== 'idle' && state !== 'saving' && state !== 'saved' && <span className="ml-2 text-[11px] text-red-700">{state}</span>}
      </td>
    </tr>
  )
}

export default function SchedulesBlock({ managers, schedules, onSaved }: {
  managers: { userId: number; name: string }[]
  schedules: ManagerSchedule[]
  onSaved: () => void
}) {
  const byId = new Map(schedules.map(s => [s.amo_user_id, s]))
  const rows = [...managers]
  for (const s of schedules) if (!rows.some(m => m.userId === s.amo_user_id)) rows.push({ userId: s.amo_user_id, name: s.name })
  return (
    <Card title="Графики" hint="Дата выхода, часы и рабочие дни. По ним считаются поздний старт, ранний финиш и пустые дни; до даты выхода дни человеку не в вину. Снять «продавец B2C» — человек уходит в справочный блок: нормы и подсказки к нему не применяются. Менять может владелец.">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[11px] text-[#9a9a95] text-left border-b border-[#e4e4e0]">
              <th className="py-1.5 pr-2 font-normal">Менеджер</th>
              <th className="py-1.5 px-1 font-normal">Работает с</th>
              <th className="py-1.5 px-1 font-normal">Часы</th>
              <th className="py-1.5 px-1 font-normal">Дни</th>
              <th className="py-1.5 px-1 font-normal">Заметка</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              // перемонтируем строку, только когда график впервые подгрузился, — иначе «сохранено» пропадёт
              <Row key={`${m.userId}:${byId.has(m.userId) ? 1 : 0}`}
                userId={m.userId} name={m.name} s={byId.get(m.userId)} onSaved={onSaved} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
