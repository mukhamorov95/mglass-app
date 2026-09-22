'use client'

import { useEffect, useState } from 'react'
import MyDay from '@/components/MyDay'
import { Card } from './ui'

// Владельцу — ровно то, что видит менеджер у себя на главной. Пересчёт по кнопке:
// утренний снимок к вечеру устаревает, а полный сбор — около минуты запросов к amo.

type Row = { amo_user_id: number; name: string; computed_at: string }

export default function CoachingPreview() {
  const [rows, setRows] = useState<Row[]>([])
  const [who, setWho] = useState<number | null>(null)
  const [state, setState] = useState<'idle' | 'busy' | string>('idle')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    fetch('/api/manager/coaching')
      .then(r => r.json())
      .then(j => {
        if (!Array.isArray(j.managers)) throw new Error(j.error ?? 'Не удалось получить список')
        setRows(j.managers)
        setWho(prev => prev ?? j.managers[0]?.amo_user_id ?? null)
      })
      .catch(e => setState(e instanceof Error ? e.message : String(e)))
  }, [nonce])

  const refresh = async () => {
    setState('busy')
    const res = await fetch('/api/manager/coaching', { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    setState(res.ok ? 'idle' : (json.error ?? `Ошибка ${res.status}`))
    if (res.ok) setNonce(n => n + 1)
  }

  return (
    <Card
      title="Что видит менеджер"
      hint="Блок «Мой день» на его главной: что сделать сегодня, привычка недели и что получается. Считается кроном по будням в 7:30."
      right={
        <div className="flex items-center gap-2">
          <select value={who ?? ''} onChange={e => setWho(Number(e.target.value))}
            className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px] text-[#111110]">
            {rows.map(r => <option key={r.amo_user_id} value={r.amo_user_id}>{r.name}</option>)}
          </select>
          <button onClick={refresh} disabled={state === 'busy'}
            className="px-3 py-1.5 rounded-lg text-[12px] bg-[#111110] text-white disabled:opacity-50">
            {state === 'busy' ? 'Считаю…' : 'Пересчитать'}
          </button>
        </div>
      }
    >
      {state !== 'idle' && state !== 'busy' && <p className="text-[13px] text-red-700 mb-2">{state}</p>}
      {rows.length === 0 && state !== 'busy'
        ? <p className="text-[13px] text-[#9a9a95]">Снимка ещё нет — нажми «Пересчитать» (около минуты).</p>
        : who && <MyDay key={`${who}-${nonce}`} amoUserId={who} />}
    </Card>
  )
}
