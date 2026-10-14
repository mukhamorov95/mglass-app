'use client'

import { useEffect, useState } from 'react'
import { loadJson } from '@/lib/toast'
import type { MaterialsResponse } from './api'

type State = { data: MaterialsResponse | null; error: string | null; done: boolean }

export function useMaterials(): State & { retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State & { attempt: number }>({ data: null, error: null, done: false, attempt: -1 })

  useEffect(() => {
    let alive = true
    loadJson<MaterialsResponse>('/api/glasmen-demo/materials').then(r => {
      if (!alive) return
      if (r.data === null) return setState({ data: null, error: r.error, done: true, attempt })
      const ok = Array.isArray(r.data.materials)
      setState({
        data: ok ? r.data : null,
        error: ok ? (r.data.materials.length ? null : 'Справочник материалов пуст — нечего показать') : 'Сервер прислал материалы в неожиданном виде',
        done: true,
        attempt,
      })
    })
    return () => { alive = false }
  }, [attempt])

  const fresh = state.attempt === attempt
  return {
    data: fresh ? state.data : null,
    error: fresh ? state.error : null,
    done: fresh && state.done,
    retry: () => setAttempt(a => a + 1),
  }
}
