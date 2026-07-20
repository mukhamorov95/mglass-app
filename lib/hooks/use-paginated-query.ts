'use client'
import { useState, useEffect, useRef } from 'react'

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  loading: boolean
  nextPage: () => void
  prevPage: () => void
  goToPage: (p: number) => void
  reload: () => void
}

export function usePaginatedQuery<T>(
  buildQuery: (from: number, to: number) => Promise<{ data: T[] | null; count: number | null }>,
  pageSize = 50,
  reloadKey = 0,
): PaginatedResult<T> {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const buildQueryRef = useRef(buildQuery)
  // eslint-disable-next-line react-hooks/refs
  buildQueryRef.current = buildQuery

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1)
  }, [reloadKey])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      const { data: rows, count } = await buildQueryRef.current(from, to)
      if (!cancelled) {
        setData(rows ?? [])
        setTotal(count ?? 0)
        setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [page, pageSize, reloadKey])

  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  const hasMore = page < maxPage

  function nextPage() { if (hasMore) setPage(p => p + 1) }
  function prevPage() { if (page > 1) setPage(p => p - 1) }
  function goToPage(p: number) { setPage(Math.max(1, Math.min(p, maxPage))) }
  function reload() { setPage(p => { buildQueryRef.current((p - 1) * pageSize, p * pageSize - 1); return p }) }

  return { data, total, page, pageSize, hasMore, loading, nextPage, prevPage, goToPage, reload }
}
