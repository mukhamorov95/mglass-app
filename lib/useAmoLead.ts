'use client'

import { useEffect, useRef, useState } from 'react'
import type { AmoLeadCard } from '@/lib/amoLead'

// Расчёт по сделке AmoCRM: ?amo=<номер> в адресе калькулятора. Сделку читаем через
// /api/amo/lead — там же проверка, что она своя. Привязка к сделке идёт только после
// успешной загрузки: сервер всё равно отказал бы чужой или несуществующей.
export type AmoLeadState = { requested: number | null; lead: AmoLeadCard | null; error: string | null }

export function useAmoLeadFromUrl(onLoaded: (lead: AmoLeadCard) => void): AmoLeadState {
  const [state, setState] = useState<AmoLeadState>({ requested: null, lead: null, error: null })
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => { onLoadedRef.current = onLoaded })

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('amo'))
    if (!Number.isInteger(id) || id <= 0) return
    // Адрес известен только в браузере — отсюда и состояние в эффекте.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ requested: id, lead: null, error: null })
    ;(async () => {
      try {
        const r = await fetch(`/api/amo/lead/${id}`)
        const j = await r.json().catch(() => ({})) as { lead?: AmoLeadCard; error?: string }
        if (!r.ok || !j.lead) {
          setState({ requested: id, lead: null, error: j.error ?? `Ошибка ${r.status}` })
          return
        }
        setState({ requested: id, lead: j.lead, error: null })
        onLoadedRef.current(j.lead)
      } catch {
        setState({ requested: id, lead: null, error: 'Сервер не ответил — проверьте связь' })
      }
    })()
  }, [])

  return state
}
