'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hm } from '@/lib/morning'

// Сегодняшний день собирается по запросу: при открытии, если снимку больше 10 минут,
// и по кнопке. Сервер сам не пойдёт в amo чаще раза в 5 минут.

const STALE_MS = 10 * 60_000

export default function TodayRefresh({ updatedAt }: { updatedAt: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const started = useRef(false)

  async function refresh() {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/manager-day/today', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? `ошибка ${r.status}`)
      setProblems(j.problems ?? [])
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!updatedAt || Date.now() - Date.parse(updatedAt) > STALE_MS) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <span className="text-[13px] text-[#6b6b66]">
      {busy ? 'собираю сегодняшний день из amo и АТС…' : updatedAt ? `снимок на ${hm(updatedAt)}` : 'снимка за сегодня ещё нет'}
      {!busy && <> · <button onClick={refresh} className="text-blue-600 hover:underline">обновить</button></>}
      {error && <span role="alert" className="text-[#c23a2b]"> · не собралось: {error}</span>}
      {problems.length > 0 && <span className="text-amber-700"> · {problems.join('; ')}</span>}
    </span>
  )
}
