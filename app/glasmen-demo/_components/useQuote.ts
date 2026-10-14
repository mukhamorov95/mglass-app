'use client'

import { useEffect, useRef, useState } from 'react'
import { loadJson } from '@/lib/toast'
import type { QuoteBody, QuoteResponse } from './api'

export type QuoteState<T> = {
  data: T | null          // ответ на текущий запрос
  last: T | null          // последний полученный ответ (показываем приглушённо, пока считается новый)
  error: string | null
  loading: boolean
}

const post = (body: QuoteBody) => loadJson<QuoteResponse>('/api/glasmen-demo/quote', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Расчёт с задержкой: ответ привязан к ключу запроса, «считаю» выводится из несовпадения ключей.
export function useQuote(body: QuoteBody | null, delayMs = 350): QuoteState<QuoteResponse> {
  return useKeyed(body, async b => {
    const r = await post(b)
    return r.data === null ? { data: null, error: r.error } : { data: r.data, error: null }
  }, delayMs)
}

// Несколько расчётов разом (строки корзины): все или ошибка первой упавшей строки с её номером.
// Задержка длиннее, чем у одной детали, — пока человек меняет количество, запросы не летят;
// строки, чьё тело не изменилось, берутся из памяти, а не пересчитываются.
const LINE_CACHE_MAX = 200

export function useQuotes(bodies: QuoteBody[] | null, delayMs = 600): QuoteState<QuoteResponse[]> {
  const cache = useRef(new Map<string, QuoteResponse>())
  return useKeyed(bodies, async list => {
    const rs = await Promise.all(list.map(async b => {
      const k = JSON.stringify(b)
      const hit = cache.current.get(k)
      if (hit) return { data: hit, error: null }
      const r = await post(b)
      if (r.data !== null) {
        if (cache.current.size >= LINE_CACHE_MAX) cache.current.clear()
        cache.current.set(k, r.data)
      }
      return r
    }))
    const bad = rs.findIndex(r => r.data === null)
    if (bad >= 0) return { data: null, error: `строка ${bad + 1}: ${rs[bad].error}` }
    return { data: rs.map(r => r.data as QuoteResponse), error: null }
  }, delayMs)
}

function useKeyed<I, T>(input: I | null, run: (i: I) => Promise<{ data: T | null; error: string | null }>, delayMs: number): QuoteState<T> {
  const key = input === null ? null : JSON.stringify(input)
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null } | null>(null)
  const [last, setLast] = useState<T | null>(null)

  useEffect(() => {
    if (key === null) return
    let alive = true
    const t = setTimeout(() => {
      run(JSON.parse(key) as I).then(r => {
        if (!alive) return
        setState({ key, data: r.data, error: r.error })
        if (r.data !== null) setLast(r.data)
      })
    }, delayMs)
    return () => { alive = false; clearTimeout(t) }
    // run — новая функция на каждый рендер; запрос определяется ключом
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delayMs])

  const fresh = state && state.key === key ? state : null
  return {
    data: fresh?.data ?? null,
    last: key === null ? null : last,
    error: fresh?.error ?? null,
    loading: key !== null && !fresh,
  }
}
