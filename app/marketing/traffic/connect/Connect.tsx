'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type State = { kind: 'idle' } | { kind: 'saving' } | { kind: 'ok'; found: string[]; missing: string[] } | { kind: 'error'; message: string }

// Яндекс возвращает токен во фрагменте адреса (#access_token=…): фрагмент не уходит
// на сервер и в логи, страница сразу стирает его из адреса и отправляет токен POST-ом.
export function Connect({ authorizeUrl }: { authorizeUrl: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const token = hash.get('access_token')
    const err = hash.get('error_description') ?? hash.get('error')
    if (!token && !err) return
    window.history.replaceState(null, '', window.location.pathname)
    void (async () => {
      await Promise.resolve()
      if (err) return setState({ kind: 'error', message: `Яндекс не выдал доступ: ${err}` })
      setState({ kind: 'saving' })
      try {
        const r = await fetch('/api/marketing/metrika-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
        const j = (await r.json().catch(() => ({}))) as { error?: string; found?: string[]; missing?: string[] }
        if (!r.ok) throw new Error(j.error ?? `ошибка ${r.status}`)
        setState({ kind: 'ok', found: j.found ?? [], missing: j.missing ?? [] })
      } catch (e) {
        setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    })()
  }, [])

  if (state.kind === 'saving') return <p className="text-sm">Проверяю доступ к Метрике и сохраняю…</p>
  if (state.kind === 'ok')
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        <div className="font-medium">Метрика подключена — визиты теперь на вкладке «Посещаемость».</div>
        <div className="mt-1">Счётчики найдены: {state.found.join(', ')}.</div>
        {state.missing.length > 0 && <div className="mt-1 text-amber-800">Нет доступа к счётчику: {state.missing.join(', ')} — по этому сайту визиты будут с ошибкой.</div>}
        <Link href="/marketing/traffic" className="mt-3 inline-block rounded-lg bg-[#111110] px-3 py-2 text-white">Открыть посещаемость</Link>
      </div>
    )
  return (
    <div className="grid gap-3">
      {state.kind === 'error' && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Не подключено: {state.message}</div>}
      <p className="text-sm text-[#111110]/80">
        Откроется Яндекс: войдите под аккаунтом, где лежат счётчики Метрики, и нажмите «Разрешить». Приложение получит только чтение статистики;
        доступ отзывается на id.yandex.ru → «Данные» → «Доступы».
      </p>
      <a href={authorizeUrl} className="w-fit rounded-lg bg-[#111110] px-4 py-2 text-sm text-white">Подключить Метрику</a>
    </div>
  )
}
